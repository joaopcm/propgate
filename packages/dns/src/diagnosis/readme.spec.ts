import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHECK_KINDS } from "../check/profile";
import { DIAGNOSIS_REGISTRY } from "./codes";

const README = readFileSync(
  join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "README.md"),
  "utf8"
);

const CODE_COUNT_CLAIM = /(\d+)-code diagnosis taxonomy/;
const EVALUATOR_COUNT_CLAIM = /shipped\. Resolver, (\w+) evaluators/;
const EVALUATOR_LIST_CLAIM = /evaluators \(([^)]+)\)/;
const BLOCKQUOTE_MARKER = /^\s*>?\s*/;

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
    const list = EVALUATOR_LIST_CLAIM.exec(README)?.[1] ?? "";
    const named = new Set(
      list
        .split("\n")
        .map((line) => line.replace(BLOCKQUOTE_MARKER, ""))
        .join(" ")
        .split(",")
        .map((item) => item.trim().toLowerCase())
    );

    expect(named.size, "no 'evaluators (…)' list found").toBeGreaterThan(0);

    const missing = CHECK_KINDS.filter((kind) => !named.has(kind));

    expect(missing).toEqual([]);
  });
});
