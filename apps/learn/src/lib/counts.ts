import {
  DIAGNOSIS_REGISTRY,
  NOT_LOCALLY_REPRODUCIBLE,
  REQUIREMENTS,
  summary,
} from "@propgate/dns";
import { FIXTURE_EXPECTATIONS } from "@propgate/dns-fixtures";

/**
 * Every number the prose is allowed to state.
 *
 * The taxonomy had 74 codes when `apps/docs` was restructured and has more now.
 * A course with "seventy-eight" written into an MDX file is a course that will
 * be wrong, and wrong in the most damaging way available to a teaching
 * document: confidently, in a sentence nobody thinks to re-check.
 *
 * So no unit states a count. It calls one of these, they read the same
 * registries the test suite reads, and the number in the prose cannot drift
 * from the number in the code. `counts.spec.ts` asserts each one is derived
 * rather than a literal somebody pasted here to make a build pass.
 *
 * The pattern is `apps/docs/src/lib/counts.ts` applied to running prose rather
 * than to a page heading.
 */

export function diagnosisCodeCount(): number {
  return Object.keys(DIAGNOSIS_REGISTRY).length;
}

/** Codes with a written reason no local fixture can produce them. */
export function unreproducibleCodeCount(): number {
  return Object.keys(NOT_LOCALLY_REPRODUCIBLE).length;
}

export function fixtureCount(): number {
  return FIXTURE_EXPECTATIONS.length;
}

/** Distinct zones behind those fixtures. One zone can carry several faults. */
export function fixtureZoneCount(): number {
  return new Set(FIXTURE_EXPECTATIONS.map((entry) => entry.zone)).size;
}

export function requirementCount(): number {
  return REQUIREMENTS.length;
}

/**
 * Requirements that apply to a verifier, implemented or not.
 *
 * The denominator `@propgate/dns` publishes, and the only one worth quoting:
 * counting `not-applicable` entries would let the figure improve by
 * cataloguing more of what an MTA does. `summary()` already refuses to compute
 * a percentage of an RFC's whole text, and the course must not invent one.
 */
export function applicableRequirementCount(): number {
  return summary().applicable;
}

export function implementedRequirementCount(): number {
  return summary().implemented;
}

export function gapCount(): number {
  return summary().gaps.length;
}

export function rfcCount(): number {
  return summary().rfcs.length;
}
