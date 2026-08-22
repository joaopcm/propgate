import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHECK_KINDS } from "@propgate/dns";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands/registry";

const README = readFileSync(
  join(dirname(dirname(fileURLToPath(import.meta.url))), "README.md"),
  "utf8"
);

const ONLY_LIST = /--only <values>\s+One of: ([^.]+)\./s;
const USAGE_BLOCK = /## Usage\s*```([\s\S]*?)```/;
const FLAG = /--[a-z][a-z0-9-]*/g;

const UNIVERSAL_FLAGS = new Set(["--api-url", "--help", "--json", "--version"]);

function documentedFlags(): ReadonlySet<string> {
  const block = USAGE_BLOCK.exec(README)?.[1] ?? "";

  return new Set(block.match(FLAG) ?? []);
}

function itemsIn(list: string): ReadonlySet<string> {
  return new Set(list.split(",").map((item) => item.trim().toLowerCase()));
}

describe("the published README's check usage", () => {
  const check = COMMANDS.find((command) => command.path.join(" ") === "check");

  it("has a usage block to check at all", () => {
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
