import { coveredDiagnosisCodes } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import {
  DIAGNOSIS_REGISTRY,
  DiagnosisCode,
  NOT_LOCALLY_REPRODUCIBLE,
} from "./codes";

describe("diagnosis coverage", () => {
  it("every code is either fixture-backed or has a written reason", () => {
    const covered = coveredDiagnosisCodes();

    const uncovered = Object.values(DiagnosisCode).filter(
      (code) => !(covered.has(code) || NOT_LOCALLY_REPRODUCIBLE[code])
    );

    expect(uncovered).toEqual([]);
  });

  it("nothing claims to be unreproducible while also having a fixture", () => {
    const covered = coveredDiagnosisCodes();

    const contradictory = Object.keys(NOT_LOCALLY_REPRODUCIBLE).filter((code) =>
      covered.has(code)
    );

    expect(contradictory).toEqual([]);
  });

  it("every unreproducible reason is substantive rather than a placeholder", () => {
    for (const [code, reason] of Object.entries(NOT_LOCALLY_REPRODUCIBLE)) {
      expect(reason, `${code} needs a real explanation`).toBeDefined();
      expect(
        (reason ?? "").length,
        `${code}'s reason is too short to be useful`
      ).toBeGreaterThan(40);
    }
  });
});

describe("diagnosis registry", () => {
  it("has an entry for every code", () => {
    const missing = Object.values(DiagnosisCode).filter(
      (code) => !DIAGNOSIS_REGISTRY[code]
    );

    expect(missing).toEqual([]);
  });

  it("keys each entry by its own code, so lookups cannot silently mismatch", () => {
    for (const [key, definition] of Object.entries(DIAGNOSIS_REGISTRY)) {
      expect(definition.code).toBe(key);
    }
  });

  it("gives every code a unique docs slug", () => {
    const slugs = Object.values(DIAGNOSIS_REGISTRY).map((d) => d.slug);

    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("writes summaries for end users, not for us", () => {
    for (const definition of Object.values(DIAGNOSIS_REGISTRY)) {
      expect(
        definition.summary.length,
        `${definition.code} summary is too terse`
      ).toBeGreaterThan(40);
      expect(definition.summary).not.toContain("_");
    }
  });
});
