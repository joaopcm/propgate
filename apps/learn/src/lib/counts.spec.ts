import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const ANY_NUMBER = /\b\d+\b/;

import {
  applicableRequirementCount,
  diagnosisCodeCount,
  fixtureCount,
  fixtureZoneCount,
  gapCount,
  implementedRequirementCount,
  requirementCount,
  rfcCount,
  unreproducibleCodeCount,
} from "./counts";

describe("the counts", () => {
  it("are all non-zero", () => {
    expect(diagnosisCodeCount()).toBeGreaterThan(0);
    expect(unreproducibleCodeCount()).toBeGreaterThan(0);
    expect(fixtureCount()).toBeGreaterThan(0);
    expect(fixtureZoneCount()).toBeGreaterThan(0);
    expect(requirementCount()).toBeGreaterThan(0);
    expect(applicableRequirementCount()).toBeGreaterThan(0);
    expect(implementedRequirementCount()).toBeGreaterThan(0);
    expect(rfcCount()).toBeGreaterThan(0);
  });

  it("keeps applicable below total, because some requirements do not apply", () => {
    expect(applicableRequirementCount()).toBeLessThan(requirementCount());
  });

  it("accounts for every applicable requirement as implemented or a gap", () => {
    expect(implementedRequirementCount() + gapCount()).toBe(
      applicableRequirementCount()
    );
  });

  it("counts no more zones than fixtures, because one zone can carry several", () => {
    expect(fixtureZoneCount()).toBeLessThanOrEqual(fixtureCount());
  });

  it("contains no numeric literals other than zero", () => {
    const source = readFileSync(join(import.meta.dirname, "counts.ts"), "utf8");
    const code = source.replace(BLOCK_COMMENT, "");

    expect(code).not.toMatch(ANY_NUMBER);
  });
});
