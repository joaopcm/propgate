import type {
  DomainExpectations,
  PerDomainField,
  ProfileDefinition,
  ProfileRequirement,
} from "@propgate/db";
import { PER_DOMAIN_FIELDS_BY_CHECK } from "@propgate/db";
import { discriminatorFor } from "./compile";

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

export function rejectUnsatisfiedExpectations(
  profileKey: string,
  definition: ProfileDefinition,
  expectations: DomainExpectations | null
): string | null {
  const missing = firstUnsupplied(definition, expectations);

  if (missing !== null) {
    return `profile "${profileKey}" requires expectations.${missing.requirementKey}.${missing.field}, which was not supplied`;
  }

  return rejectCollisions(profileKey, definition, expectations);
}

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
