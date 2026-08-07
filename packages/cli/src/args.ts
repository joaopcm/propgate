import { type ParseArgsConfig, parseArgs } from "node:util";
import { type Command, commandName, type Field } from "./command";

/**
 * Argument parsing, kept away from anything that touches DNS.
 *
 * `node:util`'s `parseArgs` rather than a dependency: the resolver underneath
 * this package has zero runtime dependencies, and a CLI that pulls in a tree of
 * argument parsers to read six flags muddies what that claim is about. (The
 * prompt layer is a dependency, deliberately — it does something `node:util`
 * does not, and it is loaded only when there is a person to prompt.)
 *
 * The option table is derived **per command** from its `Field[]`. That is
 * stronger than the two hand-written tables it replaces, which kept
 * `propgate check example.com --code 123456` from parsing by keeping the check
 * and account flags disjoint. Per-command tables keep every pair disjoint, so
 * `check` can gain `--api-url` without `confirm`'s `--code` becoming valid on it.
 */

type OptionTable = NonNullable<ParseArgsConfig["options"]>;

function optionFor(field: Field): OptionTable[string] {
  if (field.kind === "boolean") {
    return { type: "boolean" };
  }

  return {
    multiple: field.kind === "multiselect" || field.repeatable === true,
    type: "string",
  };
}

/**
 * The flags every command answers to.
 *
 * `--api-url` only where there is an API to point at, so passing it to a purely
 * local command is an error rather than a value that quietly does nothing.
 */
export function optionsFor(command: Command): OptionTable {
  const table: OptionTable = {
    help: { short: "h", type: "boolean" },
    json: { type: "boolean" },
  };

  if (command.networked) {
    table["api-url"] = { type: "string" };
  }

  for (const field of command.fields) {
    table[field.flag] = optionFor(field);
  }

  return table;
}

export type Read =
  | {
      readonly ok: true;
      readonly positionals: readonly string[];
      readonly values: Readonly<Record<string, unknown>>;
    }
  | { readonly message: string; readonly ok: false };

/**
 * `parseArgs` throws on an unknown flag, and its return type is derived from the
 * options object — so the config has to be inline at the call site for the values
 * to be typed. Wrapping the throw here keeps that inference and gives the caller
 * a value to switch on.
 */
export function readArgs(argv: readonly string[], options: OptionTable): Read {
  try {
    const { positionals, values } = parseArgs({
      allowPositionals: true,
      args: [...argv],
      options,
    });

    return { ok: true, positionals, values };
  } catch (cause) {
    return {
      message:
        cause instanceof Error ? cause.message : "could not read options",
      ok: false,
    };
  }
}

function flagUsage(field: Field): string {
  if (field.kind === "boolean") {
    return `--${field.flag}`;
  }

  if (field.kind === "multiselect") {
    return `--${field.flag} <values>`;
  }

  if (field.kind === "select") {
    return `--${field.flag} <value>`;
  }

  return `--${field.flag} <${field.placeholder ?? "value"}>`;
}

/**
 * The choices belong in the description, not in the signature.
 *
 * `--only <delegation|spf|dkim|dmarc|mx|caa>` is forty-two characters of flag
 * name, which pushes every description on the page out of alignment to
 * accommodate one line.
 */
function describeField(field: Field): string {
  const allowed = (field.choices ?? []).map((choice) => choice.value);
  const parts = [
    field.describe,
    allowed.length > 0 ? `One of: ${allowed.join(", ")}.` : "",
    field.required ? "Required." : "",
  ];

  return parts.filter((part) => part !== "").join(" ");
}

/** `domains add <domain> --profile <key>` — the line at the top of `--help`. */
export function signature(command: Command): string {
  const positional =
    command.positional === undefined
      ? ""
      : ` ${command.positional.required ? "" : "["}<${command.positional.name}>${
          command.positional.required ? "" : "]"
        }`;
  const required = command.fields
    .filter((field) => field.required)
    .map((field) => ` ${flagUsage(field)}`)
    .join("");
  const hasOptional = command.fields.some((field) => !field.required);

  return `propgate ${commandName(command)}${positional}${required}${
    hasOptional ? " [options]" : ""
  }`;
}

/** Wide enough to read, narrow enough to survive a split terminal. */
const WIDTH = 80;
const INDENT = 2;
const GAP = 2;

/** Greedy wrap. Long enough words simply overflow, which is the right failure. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";

  for (const word of text.split(" ")) {
    if (current === "") {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current !== "") {
    lines.push(current);
  }

  return lines.length === 0 ? [""] : lines;
}

/**
 * Two columns, with the width measured rather than guessed.
 *
 * A fixed column is how `--only <delegation|spf|…>` came to run straight into
 * its own description with no space between them: the flag was longer than the
 * number somebody picked, and `padEnd` cannot pad past the string it is given.
 */
function columns(
  rows: readonly (readonly [string, string])[],
  indent: number
): string[] {
  const label = Math.max(...rows.map(([name]) => name.length));
  const pad = " ".repeat(indent);
  const hanging = " ".repeat(indent + label + GAP);

  return rows.flatMap(([name, description]) =>
    wrap(description, WIDTH - indent - label - GAP).map((line, index) =>
      index === 0
        ? `${pad}${name.padEnd(label + GAP)}${line}`
        : `${hanging}${line}`
    )
  );
}

const JSON_DESCRIPTION = "Machine-readable output. Implies no prompting.";

export function usageFor(command: Command): string {
  const lines = [signature(command), "", ...wrap(command.summary, WIDTH)];

  if (command.positional !== undefined) {
    lines.push(
      "",
      "Argument",
      ...columns(
        [[`<${command.positional.name}>`, command.positional.describe]],
        INDENT
      )
    );
  }

  lines.push(
    "",
    "Options",
    ...columns(
      [
        ...command.fields.map(
          (field) =>
            [flagUsage(field), describeField(field)] as readonly [
              string,
              string,
            ]
        ),
        ["--json", JSON_DESCRIPTION] as readonly [string, string],
      ],
      INDENT
    )
  );

  if (command.examples !== undefined && command.examples.length > 0) {
    lines.push("", "Examples");

    for (const example of command.examples) {
      lines.push(`  ${example}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

/** `[2001:db8::1]:5353` — the only form where a colon can mean a port. */
const BRACKETED = /^\[(?<address>.+)\](?::(?<port>\d+))?$/;
const DEFAULT_DNS_PORT = 53;
const MAX_PORT = 65_535;

/**
 * Split `--resolver` into an address and a port.
 *
 * Port is never assumed: the whole package is written on the premise that 53 is
 * a default rather than a fact, and someone running a local resolver on 5353 is
 * the person most likely to reach for this tool.
 */
export function parseResolver(
  value: string
): { address: string; port: number } | string {
  const trimmed = value.trim();

  // A bare IPv6 address contains colons, so only a bracketed form or a single
  // trailing colon can be carrying a port.
  const bracketed = BRACKETED.exec(trimmed);

  if (bracketed?.groups) {
    return withPort(bracketed.groups.address ?? "", bracketed.groups.port);
  }

  const parts = trimmed.split(":");

  if (parts.length === 2) {
    return withPort(parts[0] ?? "", parts[1]);
  }

  return withPort(trimmed, undefined);
}

function withPort(
  address: string,
  port: string | undefined
): { address: string; port: number } | string {
  if (address === "") {
    return "resolver needs an address";
  }

  if (port === undefined) {
    return { address, port: DEFAULT_DNS_PORT };
  }

  const parsed = Number(port);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PORT) {
    return `"${port}" is not a port`;
  }

  return { address, port: parsed };
}
