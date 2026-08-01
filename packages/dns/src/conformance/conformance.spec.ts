import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REQUIREMENTS, RFC_TITLES } from "./requirements";
import { coverageByRfc, percentage, summary } from "./summary";

/**
 * The ledger is only worth publishing if it cannot be inflated by typing.
 *
 * Marking a requirement `implemented` requires naming a test that exists and
 * runs. These assertions are what stop the published figure from being an
 * opinion — the same shape as `diagnosis/coverage.spec.ts`, which stops a
 * diagnosis code from existing without a fixture.
 */

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
    // The assertion that carries the whole claim. Without it, "implemented" is
    // a word someone typed; with it, the ledger cannot outrun the test suite —
    // renaming a test breaks the build until the ledger is updated to match.
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
    // A gap with no reason is indistinguishable from an oversight, and the gap
    // list is the part of this table a consumer cannot get anywhere else.
    const unexplained = REQUIREMENTS.filter(
      (entry) =>
        entry.status !== "implemented" &&
        (entry.note ?? "").length < MINIMUM_NOTE_LENGTH
    ).map((entry) => `RFC ${entry.rfc} §${entry.section}`);

    expect(unexplained).toEqual([]);
  });

  it("does not let an implemented requirement carry an excuse", () => {
    // A note on something we do is a sign the status is wrong, or that the
    // requirement is really two requirements.
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
    // Counting not-applicable entries in the denominator would let the figure
    // be improved by cataloguing more of what an MTA does. That is precisely
    // how a coverage metric becomes a lie.
    const totals = summary();
    const notApplicable = REQUIREMENTS.filter(
      (entry) => entry.status === "not-applicable"
    ).length;

    expect(totals.applicable).toBe(REQUIREMENTS.length - notApplicable);
    expect(totals.implemented + totals.gaps.length).toBe(totals.applicable);
  });

  it("rounds down, so it is never better than the truth", () => {
    expect(percentage(99, 100)).toBe(99);
    // 2/3 is 66.6%, and printing 67% would claim a requirement we do not meet.
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
