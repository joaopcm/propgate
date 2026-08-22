import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const LIB = resolve(import.meta.dirname);
const WORKER = resolve(LIB, "../worker.ts");

const SPECIFIER = /^\s*(?:import|export)\b[^'"]*?from\s*["']([^"']+)["']/gm;
const BARE_IMPORT = /^\s*import\s*["']([^"']+)["']/gm;

function specifiersIn(file: string): string[] {
  const source = readFileSync(file, "utf8");

  return [
    ...[...source.matchAll(SPECIFIER)].map((match) => match[1] ?? ""),
    ...[...source.matchAll(BARE_IMPORT)].map((match) => match[1] ?? ""),
  ].filter((specifier) => specifier.length > 0);
}

function resolveRelative(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) {
    return;
  }

  const base = join(dirname(from), specifier);

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`${from} imports ${specifier}, which resolves to no file`);
}

interface Graph {
  readonly bare: Map<string, string>;
  readonly files: readonly string[];
}

function graphFrom(entry: string): Graph {
  const seen = new Set<string>();
  const bare = new Map<string, string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();

    if (file === undefined || seen.has(file)) {
      continue;
    }

    seen.add(file);

    for (const specifier of specifiersIn(file)) {
      const resolved = resolveRelative(file, specifier);

      if (resolved === undefined) {
        if (!bare.has(specifier)) {
          bare.set(specifier, file);
        }

        continue;
      }

      queue.push(resolved);
    }
  }

  return { bare, files: [...seen] };
}

describe("the docs Worker's import graph", () => {
  const graph = graphFrom(WORKER);

  it("reaches the negotiation module at all", () => {
    expect(graph.files.some((file) => file.endsWith("negotiate.ts"))).toBe(
      true
    );
  });

  it("imports no Node built-in", () => {
    const builtins = [...graph.bare.entries()]
      .filter(([specifier]) => specifier.startsWith("node:"))
      .map(([specifier, importer]) => `${specifier} via ${importer}`);

    expect(builtins).toEqual([]);
  });

  it("imports no workspace package", () => {
    const workspace = [...graph.bare.entries()]
      .filter(([specifier]) => specifier.startsWith("@propgate/"))
      .map(([specifier, importer]) => `${specifier} via ${importer}`);

    expect(workspace).toEqual([]);
  });

  it("stays small", () => {
    expect(graph.files.length).toBeLessThan(12);
  });
});
