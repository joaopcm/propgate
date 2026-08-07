import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { optionsFor, readArgs, usageFor } from "@propgate/cli/src/args";
import { commandName } from "@propgate/cli/src/command";
import { COMMANDS, lookup } from "@propgate/cli/src/commands/registry";
import { describe, expect, it } from "vitest";
import { CHECK_USAGE } from "../app/(docs)/cli/check/_snippets";

/**
 * The CLI pages against the CLI.
 *
 * `coverage.spec.ts` checks that every API endpoint has a page; `api.spec.ts`
 * checks the reference tables against the code. Neither could see the failure
 * that actually happened: a page that exists, is linked, and says something that
 * stopped being true. `/cli/domains` claimed six commands over six endpoints
 * after a seventh shipped, and nothing went red.
 *
 * Prose is still a person's job. A pasted `--help` block that rotted, a command
 * nobody explained, and an example that would not run are not.
 *
 * Imported deep rather than through the package entry, the same way
 * `api.spec.ts` reaches into `@propgate/db`: the CLI's entry runs a
 * `runAsProgram()` guard on import, and there is no reason to make a docs spec
 * depend on that returning false.
 */

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

/**
 * The snippets as *rendered*, not as source.
 *
 * Imported rather than read off disk. Reading the file gets you the TypeScript
 * around the strings too — trailing `";`, the explanatory prose in each file's
 * header comment — and every one of those became a phantom example the first
 * time this ran. Importing gives exactly the text that reaches a code block.
 */
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
    /**
     * The one snippet in the docs that is a *copy* of generated output.
     *
     * It was captured from a real run, which made it true on the day it was
     * written and silently wrong on the day someone adds a flag to `check`.
     * Comparing it to the generator turns that into a failing test rather than
     * a published page nobody re-reads.
     */
    const check = COMMANDS.find((command) => commandName(command) === "check");

    expect(check).toBeDefined();
    expect(`${CHECK_USAGE}\n`).toBe(usageFor(check as never));
  });
});

/**
 * Headings and inline code, which is where a command is actually *named*.
 *
 * The first version asked whether the page text contained the command name
 * anywhere, which is close to no check at all: "check" appears forty times in
 * these pages as an ordinary English verb, so the `check` command was covered
 * by sentences like "a DKIM selector to check", and `<key>:<check>` in the
 * micro-syntax covered it again. A reference has to be structural to mean
 * anything.
 */
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
      // `profiles create --require` counts for `profiles create`. The word
      // "check" in the middle of a sentence counts for nothing.
      const exact = named.has(name);
      const qualified = [...named].some((ref) => ref.startsWith(`${name} `));

      return !(exact || qualified);
    });

    expect(undocumented).toEqual([]);
  });
});

/**
 * Every runnable example, run through the CLI's own parser.
 *
 * A single allowlist of every flag on every command was the first attempt, and
 * it accepts `propgate check example.com --profile sending` — `--profile` is
 * real, just not on that command, and `parseArgs` would reject it. Handing each
 * example to `lookup` and then to the same `optionsFor`/`readArgs` the CLI runs
 * removes the gap rather than narrowing it: whatever the binary would refuse,
 * this refuses.
 *
 * Values are never checked, only shape. `<id>` and `MIGf...` are placeholders a
 * reader substitutes, and `readArgs` has no opinion about them.
 */
const CONTINUATION = /\\\n\s*/g;
const COMMENT = /\s+#\s.*$/;

/**
 * An invocation starts a line, or follows a pipe.
 *
 * Both halves are load-bearing and both were learned the hard way. A looser
 * `propgate\s+…` matched `https://example.com/hooks/propgate` in a sample
 * output block and the phrase "Ask the propgate API instead of resolving here"
 * inside the help text — and because `\s` spans newlines, the first of those
 * swallowed the line beneath it too. `propgate:` in an error message is
 * excluded for free, because the space is required.
 */
const INVOCATION =
  /(?:^[ \t]*(?:\$ )?|\|[ \t]*)(?:npx @propgate\/cli|propgate)[ \t]+([^\n]*)/gm;
const TOKEN = /'([^']*)'|"([^"]*)"|(\S+)/g;

/** Splits on spaces except inside quotes, the way a shell would. */
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

/** The words before the first flag, which is what names a command. */
function verbs(argv: readonly string[]): string[] {
  return argv.filter((token) => !token.startsWith("-"));
}

describe("examples", () => {
  it("finds the examples at all, so a silent zero cannot pass", () => {
    // Without this the assertions below go vacuously green the moment the
    // extraction stops matching anything.
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

    // The message rather than a boolean, so a failure says which flag.
    expect(read.ok ? null : read.message).toBeNull();
  });
});
