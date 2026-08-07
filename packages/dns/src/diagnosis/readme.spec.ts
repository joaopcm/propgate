import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHECK_KINDS } from "../check/profile";
import { DIAGNOSIS_REGISTRY } from "./codes";

/**
 * The package's own front page, against the package.
 *
 * This is the top of the funnel: for most readers the README is the only thing
 * they will ever read about propgate, and a status line claiming six evaluators
 * over a package with eight is the cheapest possible way to look unserious.
 *
 * It went stale exactly the way `coverage.spec.ts` exists to stop the taxonomy
 * going stale — quietly, because nothing reads prose. `apps/docs` guards its
 * pages this way already (`cli.spec.ts` against the real `--help`, `api.spec.ts`
 * against the real tables); this is the same guard for the one page that ships
 * to npm.
 *
 * Deliberately narrow. It checks the claims that are *derived from code* and
 * says nothing about the prose around them, because a spec that fails when
 * somebody improves a sentence is a spec people delete.
 */

const README = readFileSync(
  join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "README.md"),
  "utf8"
);

const CODE_COUNT_CLAIM = /(\d+)-code diagnosis taxonomy/;
const EVALUATOR_COUNT_CLAIM = /shipped\. Resolver, (\w+) evaluators/;
const EVALUATOR_LIST_CLAIM = /evaluators \(([^)]+)\)/;

describe("the published README", () => {
  it("claims the number of diagnosis codes the registry actually has", () => {
    const claimed = CODE_COUNT_CLAIM.exec(README)?.[1];

    expect(
      claimed,
      "no '<n>-code diagnosis taxonomy' claim found"
    ).toBeDefined();
    expect(Number(claimed)).toBe(Object.keys(DIAGNOSIS_REGISTRY).length);
  });

  it("claims the number of evaluators the package actually has", () => {
    const claimed = EVALUATOR_COUNT_CLAIM.exec(README)?.[1];

    // Spelled out rather than a numeral, because that is how the sentence reads.
    // Only the counts a reader could check are covered; nine would need a word
    // added here, which is the point at which somebody is looking anyway.
    const words: Readonly<Record<string, number>> = {
      eight: 8,
      five: 5,
      nine: 9,
      seven: 7,
      six: 6,
      ten: 10,
    };

    expect(claimed, "no 'Resolver, <n> evaluators' claim found").toBeDefined();
    expect(words[claimed ?? ""]).toBe(CHECK_KINDS.length);
  });

  it("names every check kind in the evaluator list", () => {
    // The parenthetical after the count. A kind missing from it is a reader
    // concluding the package cannot do something it can.
    const list = EVALUATOR_LIST_CLAIM.exec(README)?.[1] ?? "";
    const named = list.toLowerCase();

    const missing = CHECK_KINDS.filter((kind) => !named.includes(kind));

    expect(missing).toEqual([]);
  });
});
