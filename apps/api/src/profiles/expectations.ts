import type {
  DomainExpectations,
  PerDomainField,
  ProfileDefinition,
  ProfileRequirement,
} from "@propgate/db";
import { PER_DOMAIN_FIELDS_BY_CHECK } from "@propgate/db";

/**
 * Whether a domain's values satisfy the profile it is pinned to.
 *
 * The counterpart to `rejectDefinition`: that one refuses a profile the
 * evaluators could never answer, this one refuses a domain the profile could
 * never answer. Both return a sentence rather than throwing, because both are a
 * 422 and the sentence is the response body.
 *
 * This cannot be a zod schema. The definition is not known when the body is
 * parsed — it is fetched by profile key afterwards — and zod strips unknown keys
 * by default, so a typo like `expectedPublickey` would be dropped silently and
 * the domain would be monitored against no expectation at all. That is the exact
 * failure the whole mechanism exists to make impossible, so the check has to
 * happen after the lookup, here.
 *
 * Every message names the JSON path, because the reader is usually an agent
 * wiring up an integration. `EXPECTATION_MISSING` is not fixable;
 * `expectations.dkim.expectedPublicKey` is.
 */

/** Why one requirement's supplied fields cannot be accepted, or null. */
function rejectSuppliedFields(
  profileKey: string,
  requirement: ProfileRequirement,
  fields: Readonly<Record<string, string | undefined>>
): string | null {
  const deferred: readonly string[] = requirement.requiredPerDomain ?? [];

  for (const field of Object.keys(fields)) {
    if (deferred.includes(field)) {
      continue;
    }

    return PER_DOMAIN_FIELDS_BY_CHECK[requirement.check].length === 0
      ? `requirement "${requirement.key}" checks ${requirement.check} and takes no per-domain fields, so "${field}" cannot be supplied here`
      : `requirement "${requirement.key}" does not require "${field}" per domain; profile "${profileKey}" would ignore it`;
  }

  return null;
}

/** The first field a requirement asked for and did not get, or null. */
function firstUnsupplied(
  definition: ProfileDefinition,
  expectations: DomainExpectations | null
): { field: PerDomainField; requirementKey: string } | null {
  for (const requirement of definition.requirements) {
    for (const field of requirement.requiredPerDomain ?? []) {
      const value = expectations?.[requirement.key]?.[field];

      if (value === undefined || value.trim().length === 0) {
        return { field, requirementKey: requirement.key };
      }
    }
  }

  return null;
}

/**
 * Whether this profile can be run against these values at all.
 *
 * Only asks "is everything it needs here", and deliberately says nothing about
 * anything extra. Used for values *carried forward* rather than submitted: a
 * domain re-pointed at another profile keeps whatever its previous one asked for,
 * and those keys are legitimately unknown to the new definition.
 */
export function rejectUnsatisfiedExpectations(
  profileKey: string,
  definition: ProfileDefinition,
  expectations: DomainExpectations | null
): string | null {
  const missing = firstUnsupplied(definition, expectations);

  return missing === null
    ? null
    : `profile "${profileKey}" requires expectations.${missing.requirementKey}.${missing.field}, which was not supplied`;
}

/**
 * The same, plus every way a *submitted* object can be malformed.
 *
 * The extra strictness applies to values the caller just sent, and only to those.
 * A key or field the profile does not use is a typo in this request — and a
 * mistyped key is worse than useless, because the domain looks configured and is
 * compared against nothing. Ignoring it would be indistinguishable from honouring
 * it, and the caller would find out from a dashboard weeks later, if at all.
 *
 * Stale keys already in storage get the lenient check above instead, because they
 * are not a mistake anybody is making right now.
 */
export function rejectExpectations(
  profileKey: string,
  definition: ProfileDefinition,
  expectations: DomainExpectations | null
): string | null {
  const byKey = new Map(
    definition.requirements.map((requirement) => [requirement.key, requirement])
  );

  for (const [requirementKey, fields] of Object.entries(expectations ?? {})) {
    const requirement = byKey.get(requirementKey);

    if (requirement === undefined) {
      return `expectations name "${requirementKey}", which is not a requirement in profile "${profileKey}"`;
    }

    const rejection = rejectSuppliedFields(
      profileKey,
      requirement,
      fields ?? {}
    );

    if (rejection !== null) {
      return rejection;
    }
  }

  return rejectUnsatisfiedExpectations(profileKey, definition, expectations);
}
