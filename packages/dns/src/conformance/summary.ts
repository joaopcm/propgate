import type { Requirement, RequirementStatus } from "./requirements";
import { REQUIREMENTS, RFC_TITLES } from "./requirements";

export interface RfcCoverage {
  readonly applicable: number;
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

export function percentage(implemented: number, applicable: number): number {
  return applicable === 0 ? 0 : Math.floor((implemented / applicable) * 100);
}
