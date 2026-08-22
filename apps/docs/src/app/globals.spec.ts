import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(process.cwd(), "src");
const GLOBALS_CSS_PATH = join(SRC_DIR, "app/globals.css");
const THIS_FILE_PATH = join(SRC_DIR, "app/globals.spec.ts");
const BUILT_CSS_CHUNKS_DIR = join(process.cwd(), "out/_next/static/chunks");

const THEME_BLOCK_PATTERN = /@theme inline \{([^}]*)\}/;
const ROOT_BLOCK_PATTERN = /:root,[\s\S]*?\.dark\s*\{([^}]*)\}/;
const CUSTOM_PROPERTY_PATTERN = /--([a-z][a-z0-9-]*):\s*([^;]+);/g;
const THEME_COLOR_VAR_PATTERN = /^var\(--([a-z][a-z0-9-]*)\)$/;
const VAR_COLOR_REFERENCE_PATTERN = /var\(--color-([a-z][a-z0-9-]*)\)/g;
const UTILITY_CLASS_PATTERN =
  /(?<=^|[\s"'`])(?:[^\s:"'`]*:)*(?:bg|text|border)-[^\s"'`]+/g;
const DECLARED_CSS_VAR_PATTERN = /--([a-z][a-z0-9-]*)\s*:/g;
const VAR_REFERENCE_IN_RULE_PATTERN = /var\(--([a-z][a-z0-9-]*)\)/g;
const NON_CLASS_NAME_CHAR_PATTERN = /[^a-zA-Z0-9_-]/g;
const CLASS_NAME_CONTINUATION_PATTERN = /[\\_a-zA-Z0-9-]/;
const SOURCE_FILE_PATTERN = /\.(?:ts|tsx|mdx)$/;

interface TokenChain {
  readonly declaredVar: string;
  readonly resolved: boolean;
}

interface TokenUsage {
  readonly location: string;
  readonly name: string;
}

interface UtilityUsage {
  readonly className: string;
  readonly path: string;
}

type UtilityResolution =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

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

function collectVarUsages(path: string, content: string): TokenUsage[] {
  const usages: TokenUsage[] = [];

  for (const match of content.matchAll(VAR_COLOR_REFERENCE_PATTERN)) {
    const [fullMatch, name] = match;

    if (name) {
      usages.push({ location: `${path}: ${fullMatch}`, name });
    }
  }

  return usages;
}

function describeUnresolvedVar(
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

  it("resolves every var(--color-x) reference in source", () => {
    const usages = listSourceFiles(SRC_DIR).flatMap((path) =>
      collectVarUsages(path, readFileSync(path, "utf8"))
    );

    const unresolved = usages
      .filter((usage) => !chains.get(usage.name)?.resolved)
      .map((usage) => describeUnresolvedVar(usage, chains));

    expect(
      unresolved,
      `unresolved token reference(s):\n${unresolved.join("\n")}`
    ).toEqual([]);
  });
});

function readBuiltCss(): string | undefined {
  if (!existsSync(BUILT_CSS_CHUNKS_DIR)) {
    return;
  }

  const cssFiles = readdirSync(BUILT_CSS_CHUNKS_DIR).filter((name) =>
    name.endsWith(".css")
  );

  if (cssFiles.length === 0) {
    return;
  }

  return cssFiles
    .map((name) => readFileSync(join(BUILT_CSS_CHUNKS_DIR, name), "utf8"))
    .join("\n");
}

function collectUtilityUsages(path: string, content: string): UtilityUsage[] {
  const usages: UtilityUsage[] = [];

  for (const match of content.matchAll(UTILITY_CLASS_PATTERN)) {
    const [className] = match;

    if (className) {
      usages.push({ className, path });
    }
  }

  return usages;
}

function collectDeclaredCssVars(css: string): Set<string> {
  const declared = new Set<string>();

  for (const match of css.matchAll(DECLARED_CSS_VAR_PATTERN)) {
    const [, name] = match;

    if (name) {
      declared.add(name);
    }
  }

  return declared;
}

function escapeForSelector(text: string): string {
  return text.replace(NON_CLASS_NAME_CHAR_PATTERN, (char) => `\\${char}`);
}

function isClassNameBoundary(char: string): boolean {
  return !CLASS_NAME_CONTINUATION_PATTERN.test(char);
}

function findRuleBodies(css: string, selector: string): string[] {
  const bodies: string[] = [];
  let searchFrom = 0;

  while (searchFrom <= css.length) {
    const index = css.indexOf(selector, searchFrom);

    if (index === -1) {
      return bodies;
    }

    const nextChar = css.charAt(index + selector.length);

    if (isClassNameBoundary(nextChar)) {
      const bodyStart = css.indexOf("{", index);
      const bodyEnd = css.indexOf("}", bodyStart);

      bodies.push(css.slice(bodyStart + 1, bodyEnd));
    }

    searchFrom = index + selector.length;
  }

  return bodies;
}

function findDanglingVarName(
  body: string,
  declaredVars: Set<string>
): string | undefined {
  for (const match of body.matchAll(VAR_REFERENCE_IN_RULE_PATTERN)) {
    const [, varName] = match;

    if (varName && !declaredVars.has(varName)) {
      return varName;
    }
  }
}

function resolveUtility(
  css: string,
  className: string,
  declaredVars: Set<string>
): UtilityResolution {
  const selector = `.${escapeForSelector(className)}`;
  const bodies = findRuleBodies(css, selector);

  if (bodies.length === 0) {
    return { ok: false, reason: "Tailwind generated no rule for this class" };
  }

  const danglingPerBody = bodies.map((body) =>
    findDanglingVarName(body, declaredVars)
  );

  if (danglingPerBody.some((dangling) => dangling === undefined)) {
    return { ok: true };
  }

  const [firstDangling] = danglingPerBody;

  return {
    ok: false,
    reason: `resolves to var(--${firstDangling}), which is never declared`,
  };
}

const builtCss = readBuiltCss();

describe.skipIf(builtCss === undefined)(
  "utility-class tokens against the built stylesheet",
  () => {
    it("resolves every bg-/text-/border- utility referenced in source", () => {
      const css = builtCss as string;
      const declaredVars = collectDeclaredCssVars(css);
      const usages = listSourceFiles(SRC_DIR).flatMap((path) =>
        collectUtilityUsages(path, readFileSync(path, "utf8"))
      );

      const unresolved: string[] = [];

      for (const usage of usages) {
        const resolution = resolveUtility(css, usage.className, declaredVars);

        if (!resolution.ok) {
          unresolved.push(
            `${usage.className} — ${resolution.reason} (${usage.path})`
          );
        }
      }

      expect(
        unresolved,
        `unresolved utility class(es):\n${unresolved.join("\n")}`
      ).toEqual([]);
    });
  }
);
