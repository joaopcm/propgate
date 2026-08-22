import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REQUIREMENTS, RFC_TITLES } from "./requirements";
import { coverageByRfc, percentage, summary } from "./summary";

const PACKAGE_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const MINIMUM_NOTE_LENGTH = 40;
const SECTION = /^\d+(\.\d+)*$/;

function specSource(path: string): string {
  return readFileSync(join(PACKAGE_ROOT, path), "utf8");
}

describe("every implemented requirement names a test that exists", () => {
  const implemented = REQUIREMENTS.filter(
    (entry) => entry.status === "implemented"
  );

  it("has at least one proof each", () => {
    const unproven = implemented
      .filter((entry) => (entry.proof ?? []).length === 0)
      .map((entry) => `RFC ${entry.rfc} §${entry.section}`);

    expect(unproven).toEqual([]);
  });

  it("names spec files that are really there", () => {
    const missing = implemented
      .flatMap((entry) => entry.proof ?? [])
      .map((proof) => proof.spec)
      .filter((path) => !existsSync(join(PACKAGE_ROOT, path)));

    expect([...new Set(missing)]).toEqual([]);
  });

  it("names tests that are really in them", () => {
    const dangling: string[] = [];

    for (const entry of implemented) {
      for (const proof of entry.proof ?? []) {
        if (!existsSync(join(PACKAGE_ROOT, proof.spec))) {
          continue;
        }

        if (!specSource(proof.spec).includes(`"${proof.test}"`)) {
          dangling.push(
            `RFC ${entry.rfc} §${entry.section} → ${proof.spec}: "${proof.test}"`
          );
        }
      }
    }

    expect(dangling).toEqual([]);
  });
});

describe("every gap is explained", () => {
  it("gives a reason for anything not implemented or not applicable", () => {
    const unexplained = REQUIREMENTS.filter(
      (entry) =>
        entry.status !== "implemented" &&
        (entry.note ?? "").length < MINIMUM_NOTE_LENGTH
    ).map((entry) => `RFC ${entry.rfc} §${entry.section}`);

    expect(unexplained).toEqual([]);
  });

  it("does not let an implemented requirement carry an excuse", () => {
    const explained = REQUIREMENTS.filter(
      (entry) => entry.status === "implemented" && entry.note !== undefined
    ).map((entry) => `RFC ${entry.rfc} §${entry.section}`);

    expect(explained).toEqual([]);
  });
});

describe("the ledger itself", () => {
  it("names every RFC it cites", () => {
    const unnamed = [...new Set(REQUIREMENTS.map((entry) => entry.rfc))].filter(
      (rfc) => RFC_TITLES[rfc] === undefined
    );

    expect(unnamed).toEqual([]);
  });

  it("has no duplicate requirements", () => {
    const keys = REQUIREMENTS.map(
      (entry) => `${entry.rfc}|${entry.section}|${entry.requirement}`
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("cites a section for every entry", () => {
    const sectionless = REQUIREMENTS.filter(
      (entry) => !SECTION.test(entry.section)
    ).map((entry) => entry.requirement);

    expect(sectionless).toEqual([]);
  });
});

describe("the published number", () => {
  it("counts implemented over applicable, excluding what does not apply", () => {
    const totals = summary();
    const notApplicable = REQUIREMENTS.filter(
      (entry) => entry.status === "not-applicable"
    ).length;

    expect(totals.applicable).toBe(REQUIREMENTS.length - notApplicable);
    expect(totals.implemented + totals.gaps.length).toBe(totals.applicable);
  });

  it("rounds down, so it is never better than the truth", () => {
    expect(percentage(99, 100)).toBe(99);
    expect(percentage(2, 3)).toBe(66);
    expect(percentage(0, 0)).toBe(0);
  });

  it("adds up per RFC", () => {
    for (const rfc of coverageByRfc()) {
      expect(rfc.implemented + rfc.gaps.length, String(rfc.rfc)).toBe(
        rfc.applicable
      );
      expect(rfc.requirements.length).toBe(rfc.applicable + rfc.notApplicable);
    }
  });
});
