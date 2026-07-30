import { coveredDiagnosisCodes } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import {
  DIAGNOSIS_REGISTRY,
  DiagnosisCode,
  NOT_LOCALLY_REPRODUCIBLE,
} from "./codes";

/**
 * The guard that makes a ~50-code taxonomy survivable.
 *
 * A diagnosis code with no fixture is a claim we cannot support. This spec makes
 * adding one a deliberate act: either write the fixture, or write down why it
 * cannot exist locally. "We forgot" and "this is genuinely not reproducible" can
 * then never be mistaken for one another.
 *
 * Static assertions only — no containers needed, so this runs everywhere.
 */

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
      // A summary is what a customer's customer reads in a support reply, so it
      // has to be a real sentence rather than a restated code name.
      expect(
        definition.summary.length,
        `${definition.code} summary is too terse`
      ).toBeGreaterThan(40);
      expect(definition.summary).not.toContain("_");
    }
  });
});
