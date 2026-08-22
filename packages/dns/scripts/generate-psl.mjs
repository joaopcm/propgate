#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { domainToASCII, fileURLToPath } from "node:url";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUTPUT = join(PACKAGE_ROOT, "src", "psl", "data.ts");

const ICANN_BEGIN = "// ===BEGIN ICANN DOMAINS===";
const ICANN_END = "// ===END ICANN DOMAINS===";
const PRIVATE_BEGIN = "// ===BEGIN PRIVATE DOMAINS===";
const PRIVATE_END = "// ===END PRIVATE DOMAINS===";

const ASCII_LABEL = /^[a-z0-9-]+$/i;
const UPSTREAM_COMMENT = /^\/\/ Upstream commit: .*$/m;
const UPSTREAM_CONST = /^export const PSL_UPSTREAM_COMMIT = ".*";$/m;

function gh(path) {
  return execFileSync(
    "gh",
    ["api", path, "-H", "Accept: application/vnd.github.raw"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
}

function fetchList() {
  const sha = execFileSync(
    "gh",
    ["api", "repos/publicsuffix/list/commits/main", "--jq", ".sha"],
    { encoding: "utf8" }
  ).trim();

  return {
    sha,
    text: gh("repos/publicsuffix/list/contents/public_suffix_list.dat"),
  };
}

function section(lines, begin, end) {
  const from = lines.indexOf(begin);
  const to = lines.indexOf(end);

  if (from === -1 || to === -1 || to < from) {
    throw new Error(`could not find section ${begin} .. ${end}`);
  }

  return lines
    .slice(from + 1, to)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));
}

function toAscii(rule) {
  const bang = rule.startsWith("!");
  const body = bang ? rule.slice(1) : rule;

  const labels = body.split(".").map((label) => {
    if (label === "*") {
      return label;
    }

    if (ASCII_LABEL.test(label)) {
      return label.toLowerCase();
    }

    const converted = domainToASCII(label);

    if (converted === "") {
      throw new Error(`could not convert label "${label}" in rule "${rule}"`);
    }

    return converted;
  });

  return `${bang ? "!" : ""}${labels.join(".")}`;
}

function classify(rules) {
  const literals = new Set();
  const wildcards = new Set();
  const exceptions = new Set();

  for (const raw of rules) {
    const rule = toAscii(raw);

    if (rule.startsWith("!")) {
      exceptions.add(rule.slice(1));
      continue;
    }

    if (rule.includes("*")) {
      wildcards.add(rule);
      continue;
    }

    literals.add(rule);
  }

  return { exceptions, literals, wildcards };
}

function serialise(name, values) {
  const sorted = [...values].sort();

  if (sorted.length === 0) {
    return `export const ${name}: readonly string[] = [];\n`;
  }

  const entries = sorted.map((value) => `  "${value}",`).join("\n");

  return `export const ${name}: readonly string[] = [\n${entries}\n];\n`;
}

function build({ sha, text }) {
  const lines = text.split("\n");
  const icann = classify(section(lines, ICANN_BEGIN, ICANN_END));
  const priv = classify(section(lines, PRIVATE_BEGIN, PRIVATE_END));

  const header = `// GENERATED FILE — DO NOT EDIT.
//
// Vendored from https://github.com/publicsuffix/list
// Upstream commit: ${sha}
//
// Regenerate with: pnpm --filter @propgate/dns psl:refresh
//
// Rules are ASCII (punycode applied at generation time) and split by kind,
// because the matching algorithm in ./index.ts treats exceptions, wildcards, and
// literals differently.
//
// The ICANN and PRIVATE sections are kept separate on purpose. github.io lives in
// PRIVATE, so whether user.github.io is an organizational domain depends on which
// sections a caller includes — see the note on \`includePrivate\` in ./index.ts.

export const PSL_UPSTREAM_COMMIT = "${sha}";

`;

  return (
    header +
    serialise("ICANN_LITERALS", icann.literals) +
    "\n" +
    serialise("ICANN_WILDCARDS", icann.wildcards) +
    "\n" +
    serialise("ICANN_EXCEPTIONS", icann.exceptions) +
    "\n" +
    serialise("PRIVATE_LITERALS", priv.literals) +
    "\n" +
    serialise("PRIVATE_WILDCARDS", priv.wildcards) +
    "\n" +
    serialise("PRIVATE_EXCEPTIONS", priv.exceptions)
  );
}

const generated = build(fetchList());

if (process.argv.includes("--check")) {
  const existing = readFileSync(OUTPUT, "utf8");

  const strip = (text) =>
    text.replace(UPSTREAM_COMMENT, "").replace(UPSTREAM_CONST, "");

  if (strip(existing) === strip(generated)) {
    process.stdout.write("psl: vendored data matches upstream\n");
    process.exit(0);
  }

  process.stderr.write(
    "psl: vendored data is out of date — run `pnpm --filter @propgate/dns psl:refresh`\n"
  );
  process.exit(1);
}

writeFileSync(OUTPUT, generated);
process.stdout.write(`psl: wrote ${OUTPUT}\n`);
