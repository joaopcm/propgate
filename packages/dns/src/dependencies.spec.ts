import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_ROOT = join(PACKAGE_ROOT, "src");
const IMPORT_SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"'\s]+)["']/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /\/\/.*$/gm;

const TEST_ONLY = ["test"];

function isShipped(path: string): boolean {
  const rel = relative(SOURCE_ROOT, path).split(sep);

  if (rel.some((segment) => TEST_ONLY.includes(segment))) {
    return false;
  }

  return path.endsWith(".ts") && !path.endsWith(".spec.ts");
}

function shippedSources(dir = SOURCE_ROOT): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      found.push(...shippedSources(full));
      continue;
    }

    if (isShipped(full)) {
      found.push(full);
    }
  }

  return found;
}

function importsOf(path: string): string[] {
  const source = readFileSync(path, "utf8")
    .replace(BLOCK_COMMENT, "")
    .replace(LINE_COMMENT, "");
  const specifiers: string[] = [];

  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    if (match[1]) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

describe("@propgate/dns runtime dependencies", () => {
  it("declares none in package.json", () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")
    ) as { dependencies?: object; peerDependencies?: object };

    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.peerDependencies ?? {}).toEqual({});
  });

  it("imports only Node built-ins and relative paths in shipped code", () => {
    const offenders: string[] = [];

    for (const file of shippedSources()) {
      for (const specifier of importsOf(file)) {
        const allowed =
          specifier.startsWith(".") || specifier.startsWith("node:");

        if (!allowed) {
          offenders.push(`${relative(PACKAGE_ROOT, file)} -> ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("covers a meaningful number of files, so a glob bug cannot make it vacuous", () => {
    expect(shippedSources().length).toBeGreaterThan(5);
  });
});
