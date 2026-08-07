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
  DkimSelector,
  DomainProfile,
  Finding,
  Verdict,
} from "@propgate/dns";
import { outcomeFor, worstVerdict } from "@propgate/dns";

/**
 * The boundary between the two things called a profile.
 *
 * `ProfileDefinition` is what a tenant stores: a list of requirements, each
 * with a stable key, versioned so a domain can be pinned to one. `DomainProfile`
 * is what `@propgate/dns` runs: which checks, with which expectations. One
 * compiles to the other, and results come back the other way.
 *
 * Compilation and attribution live in one file on purpose. They are inverses,
 * and the failure mode if they drift is a result filed against the wrong
 * requirement — which reads as a correct answer to the wrong question, the
 * hardest kind of bug to see in a dashboard.
 */

export interface RequirementFinding {
  readonly code: string;
  readonly expected?: string;
  /**
   * The DNS name the finding is about.
   *
   * Carried because it is the most actionable part of a missing record: a bare
   * DKIM_RECORD_MISSING tells a partner something is absent, and the name tells
   * their customer where it goes.
   */
  readonly name?: string;
  readonly observed?: string;
}

export interface RequirementResult {
  readonly findings: readonly RequirementFinding[];
  readonly key: string;
  readonly satisfied: boolean;
  readonly verdict: Verdict;
}

/**
 * Past what any real record set needs. Six check kinds exist and only DKIM
 * repeats, so twenty requirements is already more selectors than a platform
 * rotates through. A profile that hits this is a loop, not a configuration.
 */
const MAX_REQUIREMENTS = 20;

/** What has already been claimed, as the requirements are walked. */
interface Claimed {
  readonly keys: Set<string>;
  readonly kinds: Set<CheckKind>;
  readonly selectors: Set<string>;
}

/** Whether this requirement takes `field` from the domain rather than from here. */
function defers(
  requirement: ProfileRequirement,
  field: PerDomainField
): boolean {
  return requirement.requiredPerDomain?.includes(field) ?? false;
}

/** The literal this requirement carries for `field`, if it carries one. */
function literalFor(
  requirement: ProfileRequirement,
  field: PerDomainField
): string | undefined {
  return requirement[field];
}

/**
 * Why a `requiredPerDomain` list cannot be stored, or null.
 *
 * Both rules exist because breaking either produces a requirement whose meaning
 * cannot be read off it: a field the check kind never looks at would be a value
 * the caller supplies forever and nothing ever compares, and a field that is both
 * literal and deferred has two answers with no rule for which wins.
 */
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

function rejectDkimRequirement(
  requirement: ProfileRequirement,
  claimed: Claimed
): string | null {
  const deferred = defers(requirement, "selector");

  if (requirement.selector === undefined && !deferred) {
    return `requirement "${requirement.key}" checks dkim and must name a selector or require one per domain`;
  }

  /**
   * A deferred selector cannot be claimed here.
   *
   * Its value is not known until a domain supplies one, so uniqueness is not
   * decidable at write time. The consequence is bounded and not a correctness
   * problem: two requirements that happen to resolve to the same selector
   * evaluate it twice and are attributed the same outcome.
   */
  if (deferred || requirement.selector === undefined) {
    return null;
  }

  if (claimed.selectors.has(requirement.selector)) {
    return `duplicate dkim selector "${requirement.selector}"`;
  }

  claimed.selectors.add(requirement.selector);

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

  // DKIM is the one check that answers a question per selector rather than per
  // domain, which is why several requirements may name it and no other check
  // may repeat.
  if (requirement.check === "dkim") {
    return rejectDkimRequirement(requirement, claimed);
  }

  if (
    requirement.check === "caa" &&
    requirement.caaIssuer === undefined &&
    !defers(requirement, "caaIssuer")
  ) {
    // The evaluator skips CAA without an issuer, so the requirement would have
    // no outcome to report against for the life of the profile. Deferring it is
    // a promise the domain keeps instead, which registration enforces.
    return `requirement "${requirement.key}" checks caa and must name an issuer or require one per domain`;
  }

  if (claimed.kinds.has(requirement.check)) {
    return `only one requirement may check ${requirement.check}`;
  }

  claimed.kinds.add(requirement.check);

  return null;
}

/**
 * Why a definition cannot be stored, or null.
 *
 * Every rule here exists because breaking it produces a requirement that can
 * never be reported on — a promise the API would take at write time and fail
 * to keep at read time, which is strictly worse than a 422.
 */
export function rejectDefinition(definition: ProfileDefinition): string | null {
  const { requirements } = definition;

  if (requirements.length === 0) {
    return "a profile needs at least one requirement";
  }

  if (requirements.length > MAX_REQUIREMENTS) {
    return `a profile may have at most ${MAX_REQUIREMENTS} requirements, got ${requirements.length}`;
  }

  const claimed: Claimed = {
    keys: new Set(),
    kinds: new Set(),
    selectors: new Set(),
  };

  for (const requirement of requirements) {
    const rejection = rejectRequirement(requirement, claimed);

    if (rejection !== null) {
      return rejection;
    }
  }

  return null;
}

/** A requirement whose deferred fields have been filled in from the domain. */
interface MergedRequirement {
  readonly caaIssuer?: string;
  readonly check: ProfileRequirement["check"];
  readonly expectedPublicKey?: string;
  readonly expectsMail?: boolean;
  readonly include?: string;
  readonly key: string;
  readonly selector?: string;
}

/** A deferred field with nothing behind it. Named so the caller can say which. */
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

/**
 * The value for one field, from whichever side owns it.
 *
 * Blank counts as absent. A zero-length `include` would be compared against
 * every SPF term and match none of them, which is a fail nobody can act on;
 * absent is the honest reading and produces `incomplete` instead.
 */
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

/**
 * A definition and a domain's values, merged, or the reason they cannot be.
 *
 * A value in `expectations` for a field the profile did not defer is ignored
 * rather than honoured, and a key naming no requirement is ignored too. Both are
 * what keeps the profile a contract: nothing a domain sends can widen what it is
 * checked against, only fill in what the profile asked it to.
 */
function merge(
  definition: ProfileDefinition,
  expectations: DomainExpectations | null
): { merged: readonly MergedRequirement[]; missing: MissingExpectation[] } {
  const missing: MissingExpectation[] = [];

  const merged = definition.requirements.map((requirement) => {
    // Partial rather than a bare Record: `resolved.selector` has to read as
    // possibly absent, which is the whole question the guard below asks.
    const resolved: Partial<Record<PerDomainField, string>> = {};

    for (const field of PER_DOMAIN_FIELDS_BY_CHECK[requirement.check]) {
      const value = valueFor(requirement, field, expectations);

      if (value !== undefined) {
        resolved[field] = value;
        continue;
      }

      /**
       * Absence is only a fault for a field the profile deferred.
       *
       * An SPF requirement with no `include` is a legitimate weaker question —
       * "is this record valid" rather than "does it authorise us". A deferred
       * field with nothing behind it is not: somebody promised a value at write
       * time and it is not here.
       */
      if (defers(requirement, field)) {
        missing.push({ field, requirementKey: requirement.key });
      }
    }

    /**
     * A DKIM requirement carrying no selector and deferring none either.
     *
     * `rejectDefinition` makes this unreachable for a stored profile — a deferred
     * selector is already filed by the loop above, so this only covers a
     * definition that names neither. Handled anyway because the alternative is
     * worse than an impossible branch: the old code substituted an empty string,
     * which queries `._domainkey.example.com`, gets NXDOMAIN, and reports a
     * failure the customer cannot act on. A false fail feeds hysteresis and pages
     * somebody.
     */
    if (
      requirement.check === "dkim" &&
      resolved.selector === undefined &&
      !defers(requirement, "selector")
    ) {
      missing.push({ field: "selector", requirementKey: requirement.key });
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

/**
 * A stable digest of what this domain is actually compared against.
 *
 * Over the *merged* set rather than the domain's own values, which is what makes
 * it move when a re-point changes a profile literal with no expectations write.
 * Canonical by construction: requirement keys sorted, then field names sorted,
 * so two equal sets cannot differ by insertion order. Null-byte separated so a
 * value cannot spell out another entry.
 */
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
  // Present because `merge` files a missing selector, so this is only reached on
  // the runnable path. No empty-string fallback: see the comment there.
  const selector = requirement.selector as string;

  return requirement.expectedPublicKey === undefined
    ? selector
    : { expectedPublicKey: requirement.expectedPublicKey, selector };
}

/**
 * A stored definition and a domain's values, as something the resolver can run.
 *
 * `id` is the profile *version* id rather than the profile key, so a result
 * carries the exact definition it was produced against — the point of pinning
 * a version in the first place.
 *
 * `expectations` is required rather than defaulted, and that is load-bearing. A
 * default would let every existing call site keep compiling while silently
 * passing nothing, and a missing expectation used to be indistinguishable from
 * "any valid key is fine" — so the bug would have shipped green. Making it
 * required means the type checker enumerates the callers.
 *
 * Returns a union rather than throwing or returning null, because the caller
 * needs to know *which* requirement it cannot answer in order to report against
 * it.
 */
export function compileProfile(
  definition: ProfileDefinition,
  id: string,
  expectations: DomainExpectations | null
): CompiledProfile {
  const { merged, missing } = merge(definition, expectations);

  if (missing.length > 0) {
    return { kind: "incomplete", missing };
  }

  const find = (check: CheckKind) =>
    merged.find((requirement) => requirement.check === check);

  const dkimSelectors = merged
    .filter((requirement) => requirement.check === "dkim")
    .map(dkimSelectorFor);

  const spf = find("spf");
  const caa = find("caa");
  const mx = find("mx");

  return {
    fingerprint: fingerprintOf(merged),
    kind: "runnable",
    profile: {
      checks: [...new Set(merged.map((requirement) => requirement.check))],
      id,
      ...(dkimSelectors.length === 0 ? {} : { dkimSelectors }),
      ...(spf?.include === undefined ? {} : { spfInclude: spf.include }),
      ...(caa?.caaIssuer === undefined ? {} : { caaIssuer: caa.caaIssuer }),
      // Tri-state all the way down: a tenant who did not say has not asserted the
      // domain receives mail, and inventing the assertion reports every
      // sending-only domain as broken.
      ...(mx?.expectsMail === undefined ? {} : { expectsMail: mx.expectsMail }),
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

/**
 * A run, filed back against the requirements that asked for it.
 *
 * `satisfied` treats `warn` as met, because a warning is advice about something
 * that is working — `p=none` is a real DMARC record. `indeterminate` is not
 * met and not failed; it is the reason the caller above must leave the domain's
 * state alone rather than transitioning it.
 *
 * Takes `expectations` for one reason: a DKIM outcome is keyed by selector, and a
 * requirement that defers its selector carries none. Reading `requirement.selector`
 * here would compare a resolved `"acme-1"` against `undefined`, match nothing, and
 * file a passing check as `indeterminate` — leaving the domain unverifiable
 * forever. `valueFor` is the same resolution `compileProfile` used to build the
 * profile the resolver ran, which is what keeps the two from drifting; the header
 * of this file is about exactly that failure.
 */
export function attributeResults(
  definition: ProfileDefinition,
  result: CheckResult,
  expectations: DomainExpectations | null
): readonly RequirementResult[] {
  return definition.requirements.map((requirement) => {
    const outcome = outcomeFor(result, requirement.check);
    const selector = valueFor(requirement, "selector", expectations);
    const source =
      requirement.check === "dkim"
        ? outcome?.selectors?.find((entry) => entry.selector === selector)
        : outcome;

    // No outcome means the check never ran. `rejectDefinition` rules out every
    // way that can happen at write time, so reaching it means the resolver
    // returned less than it was asked for — uncertainty, not a pass.
    const verdict: Verdict = source?.verdict ?? "indeterminate";

    return {
      findings: (source?.findings ?? []).map(toRequirementFinding),
      key: requirement.key,
      satisfied: verdict === "pass" || verdict === "warn",
      verdict,
    };
  });
}

/**
 * A tenant supplied no value for something their profile requires.
 *
 * Minted here rather than in `@propgate/dns`'s taxonomy on purpose. That registry
 * is a public contract whose every code must be reproducible against a fixture,
 * and nothing about DNS produces this one: it is a configuration fault on our
 * side of the wire, discovered before a single query is sent. `RequirementFinding`
 * types `code` as a string precisely so this seam exists.
 */
export const EXPECTATION_MISSING = "EXPECTATION_MISSING";

/**
 * An incomplete compile, filed against the requirements that caused it.
 *
 * Every requirement reads `indeterminate`, not just the incomplete ones: no
 * check ran, so nothing is known about any of them. Saying `pass` for the rest
 * would be reporting on questions nobody asked.
 *
 * The affected requirements carry the JSON path to set, because the reader is an
 * agent or an integration and "EXPECTATION_MISSING" alone is not actionable while
 * `expectations.dkim.expectedPublicKey` is.
 */
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

/** The worst of the parts, over requirements rather than over checks. */
export function overallVerdict(results: readonly RequirementResult[]): Verdict {
  return worstVerdict(results.map((result) => result.verdict));
}
