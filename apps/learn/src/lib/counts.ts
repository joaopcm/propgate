import {
  DIAGNOSIS_REGISTRY,
  NOT_LOCALLY_REPRODUCIBLE,
  REQUIREMENTS,
  summary,
} from "@propgate/dns";
import { FIXTURE_EXPECTATIONS } from "@propgate/dns-fixtures";

export function diagnosisCodeCount(): number {
  return Object.keys(DIAGNOSIS_REGISTRY).length;
}

export function unreproducibleCodeCount(): number {
  return Object.keys(NOT_LOCALLY_REPRODUCIBLE).length;
}

export function fixtureCount(): number {
  return FIXTURE_EXPECTATIONS.length;
}

export function fixtureZoneCount(): number {
  return new Set(FIXTURE_EXPECTATIONS.map((entry) => entry.zone)).size;
}

export function requirementCount(): number {
  return REQUIREMENTS.length;
}

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
