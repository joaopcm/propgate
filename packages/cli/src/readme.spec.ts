import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHECK_KINDS } from "@propgate/dns";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands/registry";

/**
 * The published README's usage block, against the command it describes.
 *
 * `apps/docs` already guards its pasted `--help` this way, and the README is the
 * copy of it that nobody re-runs: it ships to npm, it is the first thing on the
 * package page, and it went two check kinds out of date without anything
 * noticing. A flag list that omits a flag is worse than no flag list, because a
 * reader concludes the tool cannot do the thing.
 *
 * Asserts presence rather than exact formatting. The README's block is
 * hand-wrapped to a narrower column than `--help` prints, and a spec demanding
 * byte equality would either forbid that or force the terminal output to match a
 * markdown file — neither of which is the thing worth protecting.
 */

const README = readFileSync(
  join(dirname(dirname(fileURLToPath(import.meta.url))), "README.md"),
  "utf8"
);

const ONLY_LIST = /--only <values>\s+One of: ([^.]+)\./s;
const USAGE_BLOCK = /## Usage\s*```([\s\S]*?)```/;
const FLAG = /--[a-z][a-z0-9-]*/g;

/**
 * Flags every command gets from `optionsFor`, plus `--version`.
 *
 * Not fields on any command, so the reverse check below would call them
 * undocumented inventions without this.
 */
const UNIVERSAL_FLAGS = new Set(["--api-url", "--help", "--json", "--version"]);

/**
 * The flags the usage block actually names, as whole tokens.
 *
 * Tokenised rather than substring-searched, and that distinction is the entire
 * value of this spec. `README.includes("--token")` is satisfied by `--token-at`,
 * so deleting the standalone `--token` row left the guard green while the
 * published README omitted the flag — a guard against undocumented flags that
 * could not see an undocumented flag.
 */
function documentedFlags(): ReadonlySet<string> {
  const block = USAGE_BLOCK.exec(README)?.[1] ?? "";

  return new Set(block.match(FLAG) ?? []);
}

/** A comma-separated list as trimmed, lowercased tokens. */
function itemsIn(list: string): ReadonlySet<string> {
  return new Set(list.split(",").map((item) => item.trim().toLowerCase()));
}

describe("the published README's check usage", () => {
  const check = COMMANDS.find((command) => command.path.join(" ") === "check");

  it("has a usage block to check at all", () => {
    // Every assertion below reads an empty string when this regex stops
    // matching, and an empty string trivially documents nothing — so a
    // reformatted README would turn these guards off rather than fail them.
    expect(check, "no `check` command in the registry").toBeDefined();
    expect(documentedFlags().size).toBeGreaterThan(0);
  });

  it("lists every flag the command actually takes", () => {
    const documented = documentedFlags();

    const missing = (check?.fields ?? [])
      .map((field) => `--${field.flag}`)
      .filter((flag) => !documented.has(flag));

    expect(missing).toEqual([]);
  });

  it("lists no flag the command does not take", () => {
    // The other direction, and just as wrong: a reader who tries a flag that was
    // renamed or removed gets a usage error from the tool that documented it.
    const real = new Set((check?.fields ?? []).map((f) => `--${f.flag}`));

    const invented = [...documentedFlags()].filter(
      (flag) => !(real.has(flag) || UNIVERSAL_FLAGS.has(flag))
    );

    expect(invented).toEqual([]);
  });

  it("names every check kind in the --only list", () => {
    const named = itemsIn(ONLY_LIST.exec(README)?.[1] ?? "");

    const missing = CHECK_KINDS.filter((kind) => !named.has(kind));

    expect(missing, "run `propgate check --help` and copy the list").toEqual(
      []
    );
  });
});
