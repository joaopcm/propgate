import type { Requirement, RequirementStatus } from "./requirements";
import { REQUIREMENTS, RFC_TITLES } from "./requirements";

/**
 * Summarising the ledger.
 *
 * The one number worth publishing is **implemented over applicable** — the
 * requirements that apply to a verifier and that we either do or do not do.
 * Counting `not-applicable` entries in the denominator would let us improve the
 * figure by cataloguing more of what an MTA does, which is the exact way a
 * coverage metric becomes a lie.
 *
 * There is deliberately no way to compute a percentage of an RFC's whole text.
 * That number does not exist, and offering an approximation of it would be
 * worse than offering nothing.
 */

export interface RfcCoverage {
  readonly applicable: number;
  /** Requirements that apply and are not implemented, with their reasons. */
  readonly gaps: readonly Requirement[];
  readonly implemented: number;
  readonly notApplicable: number;
  readonly requirements: readonly Requirement[];
  readonly rfc: number;
  readonly title: string;
}

export interface ConformanceSummary {
  readonly applicable: number;
  readonly gaps: readonly Requirement[];
  readonly implemented: number;
  readonly rfcs: readonly RfcCoverage[];
}

function countBy(
  requirements: readonly Requirement[],
  status: RequirementStatus
): number {
  return requirements.filter((entry) => entry.status === status).length;
}

export function coverageByRfc(): RfcCoverage[] {
  const numbers = [...new Set(REQUIREMENTS.map((entry) => entry.rfc))].sort(
    (a, b) => a - b
  );

  return numbers.map((rfc) => {
    const requirements = REQUIREMENTS.filter((entry) => entry.rfc === rfc);
    const implemented = countBy(requirements, "implemented");
    const notApplicable = countBy(requirements, "not-applicable");

    return {
      applicable: requirements.length - notApplicable,
      gaps: requirements.filter((entry) => entry.status === "not-implemented"),
      implemented,
      notApplicable,
      requirements,
      rfc,
      title: RFC_TITLES[rfc] ?? "",
    };
  });
}

export function summary(): ConformanceSummary {
  const rfcs = coverageByRfc();

  return {
    applicable: rfcs.reduce((total, entry) => total + entry.applicable, 0),
    gaps: rfcs.flatMap((entry) => entry.gaps),
    implemented: rfcs.reduce((total, entry) => total + entry.implemented, 0),
    rfcs,
  };
}

/**
 * Implemented over applicable, as a whole percent, rounded down.
 *
 * Rounded down so the published figure is never better than the truth. 99.6%
 * printing as 100% is exactly the rounding a reader would be annoyed to
 * discover.
 */
export function percentage(implemented: number, applicable: number): number {
  return applicable === 0 ? 0 : Math.floor((implemented / applicable) * 100);
}
