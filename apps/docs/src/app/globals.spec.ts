import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every design token this stylesheet claims to own actually resolves.
 *
 * Tailwind 4's `@theme inline` block maps `--color-x: var(--x)`; the raw
 * value lives separately in `:root, .dark`. A token only works when both
 * halves exist. This repo has shipped four bugs of exactly this shape
 * (`bg-muted`, `--color-warning`, `--color-destructive`, `--color-success`):
 * the mapping pointed at an undeclared variable, or was never mapped at all,
 * and the class compiled clean, built clean, and rendered nothing. `tsc`,
 * Biome and `next build` cannot see this — the property is syntactically
 * valid CSS, just inert. Asserting the four known names by name guards
 * nothing; the next one is a new name, so this reads the stylesheet and the
 * source tree fresh on every run.
 */

const SRC_DIR = join(process.cwd(), "src");
const GLOBALS_CSS_PATH = join(SRC_DIR, "app/globals.css");
const THIS_FILE_PATH = join(SRC_DIR, "app/globals.spec.ts");

const THEME_BLOCK_PATTERN = /@theme inline \{([^}]*)\}/;
const ROOT_BLOCK_PATTERN = /:root,[\s\S]*?\.dark\s*\{([^}]*)\}/;
const CUSTOM_PROPERTY_PATTERN = /--([a-z][a-z0-9-]*):\s*([^;]+);/g;
const THEME_COLOR_VAR_PATTERN = /^var\(--([a-z][a-z0-9-]*)\)$/;
const VAR_COLOR_REFERENCE_PATTERN = /var\(--color-([a-z][a-z0-9-]*)\)/g;
const UTILITY_COLOR_CLASS_PATTERN =
  /\b(?:bg|text|border)-([a-z]+(?:-[a-z]+)*)\b/g;
const SOURCE_FILE_PATTERN = /\.(?:ts|tsx|mdx)$/;

/**
 * Tailwind keywords that share the `bg-`/`text-`/`border-` + bare-word shape
 * a custom color token has, so the utility-class scan has to know to skip
 * them or every one would look like an unresolved token.
 *
 * This is a closed set, not a guess: every Tailwind color utility other than
 * these five bare keywords takes a numeric shade (`bg-red-500`), and shaded
 * classes never match `UTILITY_COLOR_CLASS_PATTERN` because it excludes
 * digits. The rest are the non-color utilities that happen to share a
 * prefix — text sizing, text alignment/wrap, border sides and border style.
 */
const TAILWIND_BUILTIN_UTILITY_WORDS = new Set([
  "b",
  "balance",
  "base",
  "black",
  "current",
  "dashed",
  "dotted",
  "double",
  "e",
  "end",
  "hidden",
  "inherit",
  "justify",
  "l",
  "left",
  "lg",
  "none",
  "nowrap",
  "pretty",
  "r",
  "right",
  "s",
  "sm",
  "solid",
  "start",
  "t",
  "transparent",
  "white",
  "wrap",
  "x",
  "xl",
  "xs",
  "y",
]);

interface TokenChain {
  readonly declaredVar: string;
  readonly resolved: boolean;
}

interface TokenUsage {
  readonly location: string;
  readonly name: string;
}

function parseBlock(css: string, pattern: RegExp): string {
  const match = css.match(pattern);
  const [, blockContent] = match ?? [];

  if (blockContent === undefined) {
    throw new Error(
      `could not find a block matching ${pattern} in globals.css`
    );
  }

  return blockContent;
}

function parseCustomProperties(block: string): Map<string, string> {
  const properties = new Map<string, string>();

  for (const match of block.matchAll(CUSTOM_PROPERTY_PATTERN)) {
    const [, name, value] = match;

    if (name && value) {
      properties.set(name, value.trim());
    }
  }

  return properties;
}

/**
 * Maps each `--color-x` suffix declared in `@theme inline` to whether its
 * `var(--y)` target is actually declared in `:root, .dark` — the chain the
 * four historical bugs each broke on one side of.
 */
function buildTokenChains(css: string): Map<string, TokenChain> {
  const themeProperties = parseCustomProperties(
    parseBlock(css, THEME_BLOCK_PATTERN)
  );
  const rootProperties = parseCustomProperties(
    parseBlock(css, ROOT_BLOCK_PATTERN)
  );
  const chains = new Map<string, TokenChain>();

  for (const [name, value] of themeProperties) {
    if (!name.startsWith("color-")) {
      continue;
    }

    const tokenName = name.slice("color-".length);
    const varMatch = value.match(THEME_COLOR_VAR_PATTERN);
    const [, matchedVarName] = varMatch ?? [];
    const declaredVar = matchedVarName ?? value;

    chains.set(tokenName, {
      declaredVar,
      resolved:
        matchedVarName !== undefined && rootProperties.has(matchedVarName),
    });
  }

  return chains;
}

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(path));
      continue;
    }

    if (SOURCE_FILE_PATTERN.test(entry.name) && path !== THIS_FILE_PATH) {
      files.push(path);
    }
  }

  return files;
}

function collectTokenUsages(path: string, content: string): TokenUsage[] {
  const usages: TokenUsage[] = [];

  for (const match of content.matchAll(VAR_COLOR_REFERENCE_PATTERN)) {
    const [fullMatch, name] = match;

    if (name) {
      usages.push({ location: `${path}: ${fullMatch}`, name });
    }
  }

  for (const match of content.matchAll(UTILITY_COLOR_CLASS_PATTERN)) {
    const [fullMatch, suffix] = match;

    if (suffix && !TAILWIND_BUILTIN_UTILITY_WORDS.has(suffix)) {
      usages.push({ location: `${path}: ${fullMatch}`, name: suffix });
    }
  }

  return usages;
}

function describeUnresolved(
  usage: TokenUsage,
  chains: Map<string, TokenChain>
): string {
  const chain = chains.get(usage.name);

  if (!chain) {
    return `${usage.name} — never declared in @theme inline (${usage.location})`;
  }

  return `${usage.name} — var(--${chain.declaredVar}) is not declared in :root/.dark (${usage.location})`;
}

describe("design tokens", () => {
  const css = readFileSync(GLOBALS_CSS_PATH, "utf8");
  const chains = buildTokenChains(css);

  it("resolves every --color-* mapping declared in @theme inline", () => {
    const broken = [...chains.entries()]
      .filter(([, chain]) => !chain.resolved)
      .map(([name, chain]) => `--color-${name} -> var(--${chain.declaredVar})`);

    expect(
      broken,
      `unresolved token mapping(s):\n${broken.join("\n")}`
    ).toEqual([]);
  });

  it("resolves every token referenced from source", () => {
    const usages = listSourceFiles(SRC_DIR).flatMap((path) =>
      collectTokenUsages(path, readFileSync(path, "utf8"))
    );

    const unresolved = usages
      .filter((usage) => !chains.get(usage.name)?.resolved)
      .map((usage) => describeUnresolved(usage, chains));

    expect(
      unresolved,
      `unresolved token reference(s):\n${unresolved.join("\n")}`
    ).toEqual([]);
  });
});
