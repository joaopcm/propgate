import type {
  DomainExpectations,
  PerDomainField,
  ProfileDefinition,
  ProfileRequirement,
} from "@propgate/db";
import { PER_DOMAIN_FIELDS_BY_CHECK } from "@propgate/db";
import { discriminatorFor } from "./compile";

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
 * Two repeated requirements that these values would collapse onto one name.
 *
 * `rejectDefinition` already claims a discriminator written as a literal, but a
 * deferred one has no value at profile-write time, so uniqueness is not
 * decidable there. Here it is.
 *
 * Left unchecked this is a false pass, not merely a duplicate query. Two
 * ownership requirements resolving to one label produce two outcomes under that
 * label; attribution can only take one, so the second requirement is reported
 * against the first one's result — and if the first token is published and the
 * second is not, a domain reads verified for a token nobody ever published.
 * `only()` in `compile.ts` refuses to guess, which downgrades that to
 * `indeterminate`; refusing the write is what stops it arising.
 */
function rejectCollisions(
  profileKey: string,
  definition: ProfileDefinition,
  expectations: DomainExpectations | null
): string | null {
  const claimed = new Map<string, string>();

  for (const requirement of definition.requirements) {
    const value = discriminatorFor(requirement, expectations);

    if (value === undefined) {
      continue;
    }

    const at = `${requirement.check}:${value}`;
    const first = claimed.get(at);

    if (first !== undefined) {
      const where = value === "" ? "the apex" : `"${value}"`;

      return `profile "${profileKey}" requirements "${first}" and "${requirement.key}" both check ${requirement.check} at ${where}, so neither result could be told from the other`;
    }

    claimed.set(at, requirement.key);
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

  if (missing !== null) {
    return `profile "${profileKey}" requires expectations.${missing.requirementKey}.${missing.field}, which was not supplied`;
  }

  // After the missing check, not before: a requirement with nothing behind it
  // resolves to the same empty discriminator as its neighbour, and reporting a
  // collision for two values that were simply never supplied names the wrong
  // fault.
  return rejectCollisions(profileKey, definition, expectations);
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
