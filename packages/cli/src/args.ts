import { parseArgs } from "node:util";
import { CHECK_KINDS, type CheckKind } from "@propgate/dns";

/**
 * Argument parsing, kept away from anything that touches DNS.
 *
 * `node:util`'s `parseArgs` rather than a dependency: this package is published
 * MIT as the credibility artifact, and a CLI that pulls in a tree of argument
 * parsers to read six flags undercuts the claim that the resolver underneath
 * has none.
 */

export interface Options {
  readonly caaIssuer: string | undefined;
  readonly checks: readonly CheckKind[] | undefined;
  readonly domain: string;
  readonly expectsMail: boolean | undefined;
  readonly json: boolean;
  readonly resolver: string | undefined;
  readonly selectors: readonly string[];
  readonly spfInclude: string | undefined;
  /** Print every DNS query behind the answer. */
  readonly trace: boolean;
}

export type Parsed =
  | { readonly kind: "run"; readonly options: Options }
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | { readonly kind: "error"; readonly message: string };

export const USAGE = `propgate — DNS diagnosis from the terminal

  propgate check <domain> [options]

Account and domains (see \`propgate signup --help\`)
  propgate signup --email <address>
  propgate confirm --email <address> --code <code>
  propgate keys list | create <name> | revoke <prefix>
  propgate domains add <domain> --profile <key> | list

Options
  --selector <name>     A DKIM selector to check. Repeatable.
  --spf-include <name>  An include: token that must authorise this domain.
  --caa-issuer <name>   A certificate authority that must be authorised.
  --receives-mail       This domain should receive mail, so undeliverable
                        mail is a problem. Unstated by default.
  --only <kinds>        Comma-separated: ${CHECK_KINDS.join(", ")}.
  --resolver <addr>     Resolver to query, as address or address:port.
                        Defaults to the system resolver.
  --trace               Print every DNS query behind the answer.
  --json                Machine-readable output.
  --help, --version

Exit codes
  0  nothing to fix
  1  something is wrong
  2  a check could not be completed — which is not the same as a failure
`;

function splitKinds(value: string): readonly CheckKind[] | string {
  const requested = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const unknown = requested.filter(
    (entry) => !CHECK_KINDS.includes(entry as CheckKind)
  );

  if (unknown.length > 0) {
    return `unknown check: ${unknown.join(", ")}`;
  }

  if (requested.length === 0) {
    return "--only needs at least one check";
  }

  return requested as readonly CheckKind[];
}

const OPTIONS = {
  "caa-issuer": { type: "string" },
  help: { short: "h", type: "boolean" },
  json: { type: "boolean" },
  only: { type: "string" },
  "receives-mail": { type: "boolean" },
  resolver: { type: "string" },
  selector: { multiple: true, type: "string" },
  "spf-include": { type: "string" },
  trace: { type: "boolean" },
  version: { short: "v", type: "boolean" },
} as const;

/**
 * `parseArgs` throws on an unknown flag, and its return type is derived from
 * the options object — so the config has to be inline at the call site for the
 * values to be typed. Wrapping the throw here keeps that inference and gives
 * the caller a value to switch on.
 */
function read(argv: readonly string[]) {
  try {
    return {
      ok: true,
      parsed: parseArgs({
        allowPositionals: true,
        args: [...argv],
        options: OPTIONS,
      }),
    } as const;
  } catch (cause) {
    return {
      message:
        cause instanceof Error ? cause.message : "could not read options",
      ok: false,
    } as const;
  }
}

export function parse(argv: readonly string[]): Parsed {
  const result = read(argv);

  if (!result.ok) {
    return { kind: "error", message: result.message };
  }

  const { positionals, values } = result.parsed;

  if (values.help === true || positionals.length === 0) {
    return { kind: "help" };
  }

  if (values.version === true) {
    return { kind: "version" };
  }

  const [command, domain, ...extra] = positionals;

  if (command !== "check") {
    return { kind: "error", message: `unknown command: ${command}` };
  }

  if (domain === undefined) {
    return { kind: "error", message: "check needs a domain" };
  }

  if (extra.length > 0) {
    // One domain at a time. Accepting several would make the exit code a
    // summary of unrelated answers, which is worse than running it twice.
    return { kind: "error", message: "check takes one domain" };
  }

  const only = values.only === undefined ? undefined : splitKinds(values.only);

  if (typeof only === "string") {
    return { kind: "error", message: only };
  }

  return {
    kind: "run",
    options: {
      caaIssuer: values["caa-issuer"],
      checks: only,
      domain,
      expectsMail: values["receives-mail"] === true ? true : undefined,
      json: values.json === true,
      resolver: values.resolver,
      selectors: values.selector ?? [],
      spfInclude: values["spf-include"],
      trace: values.trace === true,
    },
  };
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
