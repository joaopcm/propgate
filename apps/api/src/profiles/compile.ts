import type { ProfileDefinition, ProfileRequirement } from "@propgate/db";
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

function rejectDkimRequirement(
  requirement: ProfileRequirement,
  claimed: Claimed
): string | null {
  if (requirement.selector === undefined) {
    return `requirement "${requirement.key}" checks dkim and must name a selector`;
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

  // DKIM is the one check that answers a question per selector rather than per
  // domain, which is why several requirements may name it and no other check
  // may repeat.
  if (requirement.check === "dkim") {
    return rejectDkimRequirement(requirement, claimed);
  }

  if (requirement.check === "caa" && requirement.caaIssuer === undefined) {
    // The evaluator skips CAA without an issuer, so the requirement would have
    // no outcome to report against for the life of the profile.
    return `requirement "${requirement.key}" checks caa and must name an issuer`;
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

function dkimSelectorFor(requirement: ProfileRequirement): DkimSelector {
  const selector = requirement.selector ?? "";

  return requirement.expectedPublicKey === undefined
    ? selector
    : { expectedPublicKey: requirement.expectedPublicKey, selector };
}

/**
 * A stored definition, as something the resolver can run.
 *
 * `id` is the profile *version* id rather than the profile key, so a result
 * carries the exact definition it was produced against — the point of pinning
 * a version in the first place.
 */
export function compileProfile(
  definition: ProfileDefinition,
  id: string
): DomainProfile {
  const { requirements } = definition;
  const find = (check: CheckKind) =>
    requirements.find((requirement) => requirement.check === check);

  const dkimSelectors = requirements
    .filter((requirement) => requirement.check === "dkim")
    .map(dkimSelectorFor);

  const spf = find("spf");
  const caa = find("caa");
  const mx = find("mx");

  return {
    checks: [...new Set(requirements.map((requirement) => requirement.check))],
    id,
    ...(dkimSelectors.length === 0 ? {} : { dkimSelectors }),
    ...(spf?.include === undefined ? {} : { spfInclude: spf.include }),
    ...(caa?.caaIssuer === undefined ? {} : { caaIssuer: caa.caaIssuer }),
    // Tri-state all the way down: a tenant who did not say has not asserted the
    // domain receives mail, and inventing the assertion reports every
    // sending-only domain as broken.
    ...(mx?.expectsMail === undefined ? {} : { expectsMail: mx.expectsMail }),
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
 */
export function attributeResults(
  definition: ProfileDefinition,
  result: CheckResult
): readonly RequirementResult[] {
  return definition.requirements.map((requirement) => {
    const outcome = outcomeFor(result, requirement.check);
    const source =
      requirement.check === "dkim"
        ? outcome?.selectors?.find(
            (entry) => entry.selector === requirement.selector
          )
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

/** The worst of the parts, over requirements rather than over checks. */
export function overallVerdict(results: readonly RequirementResult[]): Verdict {
  return worstVerdict(results.map((result) => result.verdict));
}
