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
const WHITESPACE = /\s+/g;

describe("the published README's check usage", () => {
  it("lists every flag the command actually takes", () => {
    const check = COMMANDS.find(
      (command) => command.path.join(" ") === "check"
    );

    expect(check, "no `check` command in the registry").toBeDefined();

    // The command's own fields, which is what `--help` renders from. `--json`,
    // `--help` and `--api-url` are added by `optionsFor` for every command and
    // are documented where they are explained rather than in this list.
    const missing = (check?.fields ?? [])
      .map((field) => `--${field.flag}`)
      .filter((flag) => !README.includes(flag));

    expect(missing).toEqual([]);
  });

  it("names every check kind in the --only list", () => {
    const list = ONLY_LIST.exec(README)?.[1] ?? "";
    const named = list.replaceAll(WHITESPACE, " ").toLowerCase();

    const missing = CHECK_KINDS.filter((kind) => !named.includes(kind));

    expect(missing, "run `propgate check --help` and copy the list").toEqual(
      []
    );
  });
});
