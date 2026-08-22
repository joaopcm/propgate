import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DIAGNOSIS_REGISTRY, NOT_YET_EMITTED } from "./codes";

const SOURCE = dirname(dirname(fileURLToPath(import.meta.url)));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }

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
    const thin = Object.entries(NOT_YET_EMITTED)
      .filter(([, reason]) => (reason ?? "").length < 60)
      .map(([code]) => code);

    expect(thin).toEqual([]);
  });

  it("does not keep a code on the list once something emits it", () => {
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
