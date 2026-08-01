import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DIAGNOSIS_REGISTRY, NOT_YET_EMITTED } from "./codes";

/**
 * A code nothing can produce is a promise we do not keep.
 *
 * `coverage.spec.ts` proves every code has a *fixture*. That is a different
 * question from whether any evaluator ever looks for it — and nine codes were
 * published, documented and served by the API while being unreachable, because
 * nothing asked this one.
 */

const SOURCE = dirname(dirname(fileURLToPath(import.meta.url)));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }

    // The registry mentions every code by definition, and specs mention the
    // ones they assert on. Neither is an evaluator looking for a condition.
    const skip =
      !entry.endsWith(".ts") ||
      entry.endsWith(".spec.ts") ||
      path.endsWith(join("diagnosis", "codes.ts"));

    return skip ? [] : [path];
  });
}

const CORPUS = sourceFiles(SOURCE)
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

describe("every published code is reachable", () => {
  it("is either reported by an evaluator or declared as not yet emitted", () => {
    const unreachable = Object.keys(DIAGNOSIS_REGISTRY).filter(
      (code) =>
        !CORPUS.includes(`DiagnosisCode.${code}`) &&
        NOT_YET_EMITTED[code as keyof typeof NOT_YET_EMITTED] === undefined
    );

    expect(unreachable).toEqual([]);
  });

  it("gives a real reason for each one that is not", () => {
    // "Not yet" without what it would take is indistinguishable from having
    // forgotten, and this list is the one a reader uses to decide whether the
    // taxonomy is aspirational.
    const thin = Object.entries(NOT_YET_EMITTED)
      .filter(([, reason]) => (reason ?? "").length < 60)
      .map(([code]) => code);

    expect(thin).toEqual([]);
  });

  it("does not keep a code on the list once something emits it", () => {
    // Otherwise the list becomes a graveyard and stops meaning anything.
    const stale = Object.keys(NOT_YET_EMITTED).filter((code) =>
      CORPUS.includes(`DiagnosisCode.${code}`)
    );

    expect(stale).toEqual([]);
  });

  it("only lists codes that exist", () => {
    const unknown = Object.keys(NOT_YET_EMITTED).filter(
      (code) => !(code in DIAGNOSIS_REGISTRY)
    );

    expect(unknown).toEqual([]);
  });
});
