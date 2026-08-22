import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { optionsFor, readArgs, usageFor } from "@propgate/cli/src/args";
import { commandName } from "@propgate/cli/src/command";
import { COMMANDS, lookup } from "@propgate/cli/src/commands/registry";
import { describe, expect, it } from "vitest";
import { CHECK_USAGE } from "../app/(docs)/cli/check/_snippets";

const CLI_DOCS = join(process.cwd(), "src/app/(docs)/cli");

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const DOCUMENT = /\.(mdx|ts)$/;
const PAGES = walk(CLI_DOCS).filter((path) => DOCUMENT.test(path));

const PROSE = PAGES.filter((path) => path.endsWith(".mdx"))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

const EXAMPLES = (
  await Promise.all(
    PAGES.filter((path) => path.endsWith("_snippets.ts")).map(
      async (path) => await (import(path) as Promise<Record<string, unknown>>)
    )
  )
)
  .flatMap((module) => Object.values(module))
  .filter((value): value is string => typeof value === "string")
  .join("\n");

describe("generated output", () => {
  it("pastes a `--help` block that is still what the CLI prints", () => {
    const check = COMMANDS.find((command) => commandName(command) === "check");

    expect(check).toBeDefined();
    expect(`${CHECK_USAGE}\n`).toBe(usageFor(check as never));
  });
});

const HEADING = /^#+\s+(.+)$/gm;
const CODE_SPAN = /`([^`\n]+)`/g;
const PROPGATE_PREFIX = /^(?:npx @propgate\/cli|propgate)\s+/;

function references(): Set<string> {
  const found = new Set<string>();

  for (const match of [
    ...PROSE.matchAll(HEADING),
    ...PROSE.matchAll(CODE_SPAN),
  ]) {
    const text = (match[1] ?? "")
      .replaceAll("`", "")
      .replace(PROPGATE_PREFIX, "")
      .trim();

    if (text !== "") {
      found.add(text);
    }
  }

  return found;
}

describe("command coverage", () => {
  it("names every command in a heading or inline code", () => {
    const named = references();
    const undocumented = COMMANDS.map(commandName).filter((name) => {
      const exact = named.has(name);
      const qualified = [...named].some((ref) => ref.startsWith(`${name} `));

      return !(exact || qualified);
    });

    expect(undocumented).toEqual([]);
  });
});

const CONTINUATION = /\\\n\s*/g;
const COMMENT = /\s+#\s.*$/;

const INVOCATION =
  /(?:^[ \t]*(?:\$ )?|\|[ \t]*)(?:npx @propgate\/cli|propgate)[ \t]+([^\n]*)/gm;
const TOKEN = /'([^']*)'|"([^"]*)"|(\S+)/g;

function tokenize(line: string): string[] {
  return [...line.matchAll(TOKEN)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
    .filter((token) => token !== "");
}

function invocations(): { argv: string[]; line: string }[] {
  const joined = EXAMPLES.replaceAll(CONTINUATION, " ");

  return [...joined.matchAll(INVOCATION)]
    .map((match) => (match[1] ?? "").replace(COMMENT, "").trim())
    .filter((line) => line !== "")
    .map((line) => ({ argv: tokenize(line), line }));
}

const FOUND = invocations();

function verbs(argv: readonly string[]): string[] {
  return argv.filter((token) => !token.startsWith("-"));
}

describe("examples", () => {
  it("finds the examples at all, so a silent zero cannot pass", () => {
    expect(FOUND.length).toBeGreaterThan(20);
  });

  it.each(FOUND)("`$line` names a real command", ({ argv }) => {
    expect(lookup(verbs(argv)).kind).toBe("command");
  });

  it.each(FOUND)("`$line` parses", ({ argv }) => {
    const match = lookup(verbs(argv));

    if (match.kind !== "command") {
      throw new Error(`no command in "${argv.join(" ")}"`);
    }

    const read = readArgs(argv, optionsFor(match.command));

    expect(read.ok ? null : read.message).toBeNull();
  });
});
