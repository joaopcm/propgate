import { type ParseArgsConfig, parseArgs } from "node:util";
import { type Command, commandName, type Field } from "./command";

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

function describeField(field: Field): string {
  const allowed = (field.choices ?? []).map((choice) => choice.value);
  const parts = [
    field.describe,
    allowed.length > 0 ? `One of: ${allowed.join(", ")}.` : "",
    field.required ? "Required." : "",
  ];

  return parts.filter((part) => part !== "").join(" ");
}

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

const WIDTH = 80;
const INDENT = 2;
const GAP = 2;

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

const BRACKETED = /^\[(?<address>.+)\](?::(?<port>\d+))?$/;
const DEFAULT_DNS_PORT = 53;
const MAX_PORT = 65_535;

export function parseResolver(
  value: string
): { address: string; port: number } | string {
  const trimmed = value.trim();

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
