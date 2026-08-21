import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Everything the Worker bundle can reach, and what it may not contain.
 *
 * The docs deploy failed for three releases with `No such module "node:fs"`,
 * and the shape of the failure is worth keeping in mind: every asset uploaded
 * successfully, the pages were fine, and only the script validation at the very
 * end rejected it. Nothing in `pnpm build`, `pnpm lint` or `pnpm test` was red.
 *
 * The cause was one named import. `negotiate.ts` took `markdownPathFor` — two
 * lines of string arithmetic — from `markdown-pages.ts`, which reads `page.mdx`
 * off disk and pulls in the taxonomy, and through it `@propgate/dns` and
 * `@propgate/dns-fixtures`. ES modules evaluate the whole module for one named
 * import, so the Worker acquired a filesystem, a UDP socket and a DNS resolver.
 *
 * So this walks the graph from `worker.ts` and fails on anything a Worker
 * cannot have. It is a static read of import statements rather than a real
 * bundle, which is the honest limit: a dynamic `await import()` of a computed
 * path would slip past. There are none, and a plain-text walk that runs in
 * milliseconds on every `pnpm test` is worth more here than a bundler that
 * would only run at deploy.
 */

const LIB = resolve(import.meta.dirname);
const WORKER = resolve(LIB, "../worker.ts");

/** `import ... from "x"` and `export ... from "x"`, which both pull a module in. */
const SPECIFIER = /^\s*(?:import|export)\b[^'"]*?from\s*["']([^"']+)["']/gm;
/** A side-effect import, which evaluates the module and takes its imports too. */
const BARE_IMPORT = /^\s*import\s*["']([^"']+)["']/gm;

function specifiersIn(file: string): string[] {
  const source = readFileSync(file, "utf8");

  return [
    ...[...source.matchAll(SPECIFIER)].map((match) => match[1] ?? ""),
    ...[...source.matchAll(BARE_IMPORT)].map((match) => match[1] ?? ""),
  ].filter((specifier) => specifier.length > 0);
}

/** A relative specifier's file on disk, or undefined if it is a bare package. */
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
  /** Bare specifiers reached, mapped to the file that imported each. */
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

  /**
   * The assertion the deploy failure was missing. Cloudflare rejects the script
   * outright rather than failing at runtime, so there is no partial-credit
   * version of this — one `node:` import and nothing deploys.
   */
  it("imports no Node built-in", () => {
    const builtins = [...graph.bare.entries()]
      .filter(([specifier]) => specifier.startsWith("node:"))
      .map(([specifier, importer]) => `${specifier} via ${importer}`);

    expect(builtins).toEqual([]);
  });

  /**
   * Workspace packages are banned rather than merely discouraged. Every one of
   * them is written for Node: `@propgate/dns` opens UDP sockets,
   * `@propgate/dns-fixtures` resolves names, `@propgate/webhooks` uses
   * `node:crypto`. A Worker that needs data from one of them wants it
   * precomputed into an asset at build time, not the package itself.
   */
  it("imports no workspace package", () => {
    const workspace = [...graph.bare.entries()]
      .filter(([specifier]) => specifier.startsWith("@propgate/"))
      .map(([specifier, importer]) => `${specifier} via ${importer}`);

    expect(workspace).toEqual([]);
  });

  /**
   * A ceiling, not a target. The Worker reads an `Accept` header and picks a
   * file; if this list doubles, something has been imported that belongs at
   * build time, and the failure should arrive here rather than at a deploy.
   */
  it("stays small", () => {
    expect(graph.files.length).toBeLessThan(12);
  });
});
