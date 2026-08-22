import { createHash } from "node:crypto";
import type {
  DomainExpectations,
  PerDomainField,
  ProfileDefinition,
  ProfileRequirement,
} from "@propgate/db";
import { PER_DOMAIN_FIELDS_BY_CHECK } from "@propgate/db";
import type {
  CheckKind,
  CheckResult,
  CnameTarget,
  DkimSelector,
  DomainProfile,
  Finding,
  MxLabel,
  OwnershipToken,
  SpfLabel,
  Verdict,
} from "@propgate/dns";
import { outcomeFor, worstVerdict } from "@propgate/dns";

export interface RequirementFinding {
  readonly code: string;
  readonly expected?: string;
  readonly name?: string;
  readonly observed?: string;
}

export interface RequirementResult {
  readonly findings: readonly RequirementFinding[];
  readonly key: string;
  readonly satisfied: boolean;
  readonly verdict: Verdict;
}

const MAX_REQUIREMENTS = 20;

const REQUIRED_FIELDS_BY_CHECK: Readonly<
  Record<CheckKind, readonly PerDomainField[]>
> = {
  caa: ["caaIssuer"],
  cname: ["label", "target"],
  delegation: [],
  dkim: ["selector"],
  dmarc: [],
  mx: [],
  ownership: ["token"],
  spf: [],
};

const DISCRIMINATOR_BY_CHECK: Readonly<
  Partial<Record<CheckKind, PerDomainField>>
> = {
  cname: "label",
  dkim: "selector",
  mx: "label",
  ownership: "label",
  spf: "label",
};

const LABELLED_CHECKS = new Set(
  Object.entries(DISCRIMINATOR_BY_CHECK)
    .filter(([, field]) => field === "label")
    .map(([check]) => check as CheckKind)
);

interface Claimed {
  readonly discriminators: Set<string>;
  readonly keys: Set<string>;
  readonly kinds: Set<CheckKind>;
}

function defers(
  requirement: ProfileRequirement,
  field: PerDomainField
): boolean {
  return requirement.requiredPerDomain?.includes(field) ?? false;
}

function literalFor(
  requirement: ProfileRequirement,
  field: PerDomainField
): string | undefined {
  return requirement[field];
}

function rejectPerDomain(requirement: ProfileRequirement): string | null {
  const deferrable = PER_DOMAIN_FIELDS_BY_CHECK[requirement.check];

  for (const field of requirement.requiredPerDomain ?? []) {
    if (!deferrable.includes(field)) {
      return deferrable.length === 0
        ? `requirement "${requirement.key}" checks ${requirement.check}, which takes no per-domain fields, but names "${field}"`
        : `requirement "${requirement.key}" checks ${requirement.check}, which takes ${deferrable.join(" or ")} per domain, but names "${field}"`;
    }

    if (literalFor(requirement, field) !== undefined) {
      return `requirement "${requirement.key}" sets "${field}" and also requires it per domain; use one or the other`;
    }
  }

  return null;
}

const FIELD_NOUNS: Readonly<Partial<Record<PerDomainField, string>>> = {
  caaIssuer: "an issuer",
  label: "a label",
  selector: "a selector",
  target: "a target",
  token: "a token",
};

function rejectMissingField(requirement: ProfileRequirement): string | null {
  for (const field of REQUIRED_FIELDS_BY_CHECK[requirement.check]) {
    if (
      literalFor(requirement, field) === undefined &&
      !defers(requirement, field)
    ) {
      return `requirement "${requirement.key}" checks ${requirement.check} and must name ${FIELD_NOUNS[field] ?? field} or require one per domain`;
    }
  }

  return null;
}

function rejectDuplicate(
  requirement: ProfileRequirement,
  field: PerDomainField,
  claimed: Claimed
): string | null {
  if (defers(requirement, field)) {
    return null;
  }

  const value = literalFor(requirement, field);
  const taken = `${requirement.check}:${value ?? ""}`;

  if (claimed.discriminators.has(taken)) {
    return value === undefined
      ? `only one ${requirement.check} requirement may sit at the apex`
      : `duplicate ${requirement.check} ${field} "${value}"`;
  }

  claimed.discriminators.add(taken);

  return null;
}

function rejectRequirement(
  requirement: ProfileRequirement,
  claimed: Claimed
): string | null {
  if (requirement.key.length === 0) {
    return "every requirement needs a key";
  }

  if (claimed.keys.has(requirement.key)) {
    return `duplicate requirement key "${requirement.key}"`;
  }

  claimed.keys.add(requirement.key);

  const perDomain = rejectPerDomain(requirement);

  if (perDomain !== null) {
    return perDomain;
  }

  const missing = rejectMissingField(requirement);

  if (missing !== null) {
    return missing;
  }

  const discriminator = DISCRIMINATOR_BY_CHECK[requirement.check];

  if (discriminator !== undefined) {
    return rejectDuplicate(requirement, discriminator, claimed);
  }

  if (claimed.kinds.has(requirement.check)) {
    return `only one requirement may check ${requirement.check}`;
  }

  claimed.kinds.add(requirement.check);

  return null;
}

export function rejectDefinition(definition: ProfileDefinition): string | null {
  const { requirements } = definition;

  if (requirements.length === 0) {
    return "a profile needs at least one requirement";
  }

  if (requirements.length > MAX_REQUIREMENTS) {
    return `a profile may have at most ${MAX_REQUIREMENTS} requirements, got ${requirements.length}`;
  }

  const claimed: Claimed = {
    discriminators: new Set(),
    keys: new Set(),
    kinds: new Set(),
  };

  for (const requirement of requirements) {
    const rejection = rejectRequirement(requirement, claimed);

    if (rejection !== null) {
      return rejection;
    }
  }

  return null;
}

interface MergedRequirement {
  readonly caaIssuer?: string;
  readonly check: ProfileRequirement["check"];
  readonly expectedPublicKey?: string;
  readonly expectsMail?: boolean;
  readonly include?: string;
  readonly key: string;
  readonly label?: string;
  readonly selector?: string;
  readonly target?: string;
  readonly token?: string;
}

export interface MissingExpectation {
  readonly field: PerDomainField;
  readonly requirementKey: string;
}

export type CompiledProfile =
  | {
      readonly fingerprint: string;
      readonly kind: "runnable";
      readonly profile: DomainProfile;
    }
  | {
      readonly kind: "incomplete";
      readonly missing: readonly MissingExpectation[];
    };

function valueFor(
  requirement: ProfileRequirement,
  field: PerDomainField,
  expectations: DomainExpectations | null
): string | undefined {
  const raw = defers(requirement, field)
    ? expectations?.[requirement.key]?.[field]
    : literalFor(requirement, field);

  return raw === undefined || raw.trim().length === 0 ? undefined : raw;
}

export function discriminatorFor(
  requirement: ProfileRequirement,
  expectations: DomainExpectations | null
): string | undefined {
  const field = DISCRIMINATOR_BY_CHECK[requirement.check];

  if (field === undefined) {
    return;
  }

  return valueFor(requirement, field, expectations) ?? "";
}

function merge(
  definition: ProfileDefinition,
  expectations: DomainExpectations | null
): { merged: readonly MergedRequirement[]; missing: MissingExpectation[] } {
  const missing: MissingExpectation[] = [];

  const merged = definition.requirements.map((requirement) => {
    const resolved: Partial<Record<PerDomainField, string>> = {};

    for (const field of PER_DOMAIN_FIELDS_BY_CHECK[requirement.check]) {
      const value = valueFor(requirement, field, expectations);

      if (value !== undefined) {
        resolved[field] = value;
        continue;
      }

      if (defers(requirement, field)) {
        missing.push({ field, requirementKey: requirement.key });
      }
    }

    for (const field of REQUIRED_FIELDS_BY_CHECK[requirement.check]) {
      if (resolved[field] === undefined && !defers(requirement, field)) {
        missing.push({ field, requirementKey: requirement.key });
      }
    }

    return {
      check: requirement.check,
      key: requirement.key,
      ...(requirement.expectsMail === undefined
        ? {}
        : { expectsMail: requirement.expectsMail }),
      ...resolved,
    };
  });

  return { merged, missing };
}

function fingerprintOf(merged: readonly MergedRequirement[]): string {
  const hash = createHash("sha256");

  for (const requirement of [...merged].sort((a, b) =>
    a.key < b.key ? -1 : 1
  )) {
    for (const field of PER_DOMAIN_FIELDS_BY_CHECK[requirement.check]) {
      const value = requirement[field];

      if (value !== undefined) {
        hash.update(`${requirement.key} ${field} ${value} `);
      }
    }
  }

  return hash.digest("hex");
}

function dkimSelectorFor(requirement: MergedRequirement): DkimSelector {
  const selector = requirement.selector as string;

  return requirement.expectedPublicKey === undefined
    ? selector
    : { expectedPublicKey: requirement.expectedPublicKey, selector };
}

function ownershipTokenFor(requirement: MergedRequirement): OwnershipToken {
  return {
    token: requirement.token as string,
    ...(requirement.label === undefined ? {} : { label: requirement.label }),
  };
}

function cnameTargetFor(requirement: MergedRequirement): CnameTarget {
  return {
    label: requirement.label as string,
    target: requirement.target as string,
  };
}

function spfLabelFor(requirement: MergedRequirement): SpfLabel {
  return {
    ...(requirement.include === undefined
      ? {}
      : { include: requirement.include }),
    ...(requirement.label === undefined ? {} : { label: requirement.label }),
  };
}

function mxLabelFor(requirement: MergedRequirement): MxLabel {
  return {
    ...(requirement.expectsMail === undefined
      ? {}
      : { expectsMail: requirement.expectsMail }),
    ...(requirement.label === undefined ? {} : { label: requirement.label }),
  };
}

function ofKind(
  merged: readonly MergedRequirement[],
  check: CheckKind
): readonly MergedRequirement[] {
  return merged.filter((requirement) => requirement.check === check);
}

export function compileProfile(
  definition: ProfileDefinition,
  id: string,
  expectations: DomainExpectations | null
): CompiledProfile {
  const { merged, missing } = merge(definition, expectations);

  if (missing.length > 0) {
    return { kind: "incomplete", missing };
  }

  const caa = merged.find((requirement) => requirement.check === "caa");

  const dkimSelectors = ofKind(merged, "dkim").map(dkimSelectorFor);
  const ownership = ofKind(merged, "ownership").map(ownershipTokenFor);
  const cnames = ofKind(merged, "cname").map(cnameTargetFor);
  const spf = ofKind(merged, "spf").map(spfLabelFor);
  const mx = ofKind(merged, "mx").map(mxLabelFor);

  return {
    fingerprint: fingerprintOf(merged),
    kind: "runnable",
    profile: {
      checks: [...new Set(merged.map((requirement) => requirement.check))],
      id,
      ...(cnames.length === 0 ? {} : { cnames }),
      ...(dkimSelectors.length === 0 ? {} : { dkimSelectors }),
      ...(mx.length === 0 ? {} : { mx }),
      ...(ownership.length === 0 ? {} : { ownership }),
      ...(spf.length === 0 ? {} : { spf }),
      ...(caa?.caaIssuer === undefined ? {} : { caaIssuer: caa.caaIssuer }),
    },
  };
}

function toRequirementFinding(finding: Finding): RequirementFinding {
  return {
    code: finding.code,
    ...(finding.evidence.expected === undefined
      ? {}
      : { expected: finding.evidence.expected }),
    ...(finding.evidence.name === undefined
      ? {}
      : { name: finding.evidence.name }),
    ...(finding.evidence.observed === undefined
      ? {}
      : { observed: finding.evidence.observed }),
  };
}

function only<T>(matches: readonly T[] | undefined): T | undefined {
  return matches?.length === 1 ? matches[0] : undefined;
}

function sourceFor(
  requirement: ProfileRequirement,
  outcome: ReturnType<typeof outcomeFor>,
  expectations: DomainExpectations | null
) {
  if (requirement.check === "dkim") {
    const selector = valueFor(requirement, "selector", expectations);

    return only(
      outcome?.selectors?.filter((entry) => entry.selector === selector)
    );
  }

  if (LABELLED_CHECKS.has(requirement.check)) {
    const label = valueFor(requirement, "label", expectations) ?? "";

    return only(outcome?.records?.filter((entry) => entry.label === label));
  }

  return outcome;
}

export function attributeResults(
  definition: ProfileDefinition,
  result: CheckResult,
  expectations: DomainExpectations | null
): readonly RequirementResult[] {
  return definition.requirements.map((requirement) => {
    const outcome = outcomeFor(result, requirement.check);
    const source = sourceFor(requirement, outcome, expectations);

    const verdict: Verdict = source?.verdict ?? "indeterminate";

    return {
      findings: (source?.findings ?? []).map(toRequirementFinding),
      key: requirement.key,
      satisfied: verdict === "pass" || verdict === "warn",
      verdict,
    };
  });
}

export const EXPECTATION_MISSING = "EXPECTATION_MISSING";

export function attributeMissing(
  definition: ProfileDefinition,
  missing: readonly MissingExpectation[]
): readonly RequirementResult[] {
  return definition.requirements.map((requirement) => ({
    findings: missing
      .filter((entry) => entry.requirementKey === requirement.key)
      .map((entry) => ({
        code: EXPECTATION_MISSING,
        expected: `expectations.${entry.requirementKey}.${entry.field}`,
      })),
    key: requirement.key,
    satisfied: false,
    verdict: "indeterminate" as const,
  }));
}

export function overallVerdict(results: readonly RequirementResult[]): Verdict {
  return worstVerdict(results.map((result) => result.verdict));
}
