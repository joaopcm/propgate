import { parseArgs } from "node:util";
import { apiRequest } from "./client";
import { credentials, readConfig, writeConfig } from "./config";

/**
 * The commands that talk to the control plane.
 *
 * In their own module so `check` stays what it is: a local diagnostic that needs
 * no account, no config file and no network beyond DNS. Nothing in `index.ts`'s
 * check path imports this, and a machine that has never run `signup` loses
 * nothing.
 *
 * This is the first time `@propgate/cli` is a client of the API rather than a
 * resolver in its own right, which is a real conceptual step for a published MIT
 * package — hence the separation being structural rather than a convention.
 */

/** Something the caller asked for that cannot be done. */
const EXIT_USAGE = 64;
/** The API said no, or could not be reached. */
const EXIT_FAILED = 1;

const ACCOUNT_COMMANDS = ["signup", "confirm", "keys", "domains"] as const;

export type AccountCommand = (typeof ACCOUNT_COMMANDS)[number];

export function isAccountCommand(value: string): value is AccountCommand {
  return (ACCOUNT_COMMANDS as readonly string[]).includes(value);
}

export const ACCOUNT_USAGE = `propgate — account and domain management

  propgate signup --email <address>
  propgate confirm --email <address> --code <code>

  propgate keys list
  propgate keys create <name>
  propgate keys revoke <prefix|id>

  propgate domains add <domain> --profile <key> [--external-id <id>]
  propgate domains list [--state <state>]

Options
  --api-url <url>    The API to talk to. Defaults to https://api.propgate.dev.
  --json             Machine-readable output.

Credentials
  \`confirm\` stores your key in $XDG_CONFIG_HOME/propgate/config.json, mode 0600.
  PROPGATE_API_KEY overrides it; PROPGATE_API_URL overrides the URL.

  \`propgate check\` needs none of this — it resolves locally.
`;

const OPTIONS = {
  "api-url": { type: "string" },
  code: { type: "string" },
  email: { type: "string" },
  "external-id": { type: "string" },
  json: { type: "boolean" },
  profile: { type: "string" },
  state: { type: "string" },
} as const;

interface Context {
  readonly apiKey: string | undefined;
  readonly apiUrl: string;
  readonly json: boolean;
}

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fail(message: string): number {
  process.stderr.write(`propgate: ${message}\n`);

  return EXIT_FAILED;
}

/** Print an API error the way the API phrased it. */
function reportApiError(
  status: number,
  message: string | undefined,
  fallback: string
): number {
  if (status === 401) {
    return fail(
      `${message ?? fallback}\nRun \`propgate confirm\` again, or set PROPGATE_API_KEY.`
    );
  }

  return fail(message ?? fallback);
}

function requireKey(context: Context): string | null {
  if (context.apiKey === undefined) {
    process.stderr.write(
      "propgate: no API key. Run `propgate signup --email you@example.com`, then `propgate confirm`, or set PROPGATE_API_KEY.\n"
    );

    return null;
  }

  return context.apiKey;
}

function when(value: string | null): string {
  return value === null ? "never" : value.slice(0, 16).replace("T", " ");
}

async function signup(
  context: Context,
  email: string | undefined
): Promise<number> {
  if (email === undefined) {
    return fail("signup needs --email");
  }

  const result = await apiRequest<{ status: string }>({
    apiUrl: context.apiUrl,
    body: { email },
    method: "POST",
    path: "/v1/signup",
  });

  if (!result.ok) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "signup failed"
    );
  }

  if (context.json) {
    out(JSON.stringify(result.body, null, 2));

    return 0;
  }

  // Deliberately not "we sent you a code": the API answers identically whether or
  // not the address is known, and claiming a send here would be inventing a fact
  // this command cannot see.
  out(`If ${email} can receive mail, a six-digit code is on its way.`);
  out("It expires in ten minutes.");
  out("");
  out(`  propgate confirm --email ${email} --code <code>`);

  return 0;
}

async function confirm(
  context: Context,
  email: string | undefined,
  code: string | undefined
): Promise<number> {
  if (email === undefined || code === undefined) {
    return fail("confirm needs --email and --code");
  }

  const result = await apiRequest<{
    apiKey: string;
    created: boolean;
    tenantId: string;
  }>({
    apiUrl: context.apiUrl,
    body: { code, email },
    method: "POST",
    path: "/v1/signup/confirm",
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "confirmation failed"
    );
  }

  const { apiKey } = result.body.data;
  const stored = readConfig();
  const path = writeConfig({
    ...stored,
    apiKey,
    // Remember a non-default URL, so the next command does not need the flag
    // again. Omitted when it is the default, so a stored config does not pin a
    // hostname that may change.
    ...(context.apiUrl === "https://api.propgate.dev"
      ? {}
      : { apiUrl: context.apiUrl }),
  });

  if (context.json) {
    out(
      JSON.stringify({ ...result.body, meta: { configPath: path } }, null, 2)
    );

    return 0;
  }

  out(result.body.data.created ? "Account created." : "Signed in.");
  out("");
  out(`  ${apiKey}`);
  out("");
  // Both halves matter: they need to know it is saved, and that this is the only
  // time they will see it.
  out(`Stored in ${path}. It will not be shown again.`);

  return 0;
}

interface KeyRow {
  readonly createdAt: string;
  readonly id: string;
  readonly lastUsedAt: string | null;
  readonly name: string;
  readonly prefix: string;
  readonly revoked: boolean;
}

async function keysList(context: Context, apiKey: string): Promise<number> {
  const result = await apiRequest<KeyRow[]>({
    apiKey,
    apiUrl: context.apiUrl,
    path: "/v1/api-keys",
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not list keys"
    );
  }

  if (context.json) {
    out(JSON.stringify(result.body, null, 2));

    return 0;
  }

  for (const key of result.body.data) {
    out(
      [
        key.revoked ? "REVOKED" : "active ",
        key.prefix.padEnd(14),
        key.name.padEnd(16),
        `used ${when(key.lastUsedAt)}`,
      ].join("  ")
    );
  }

  return 0;
}

async function keysCreate(
  context: Context,
  apiKey: string,
  name: string | undefined
): Promise<number> {
  if (name === undefined) {
    return fail("keys create needs a name");
  }

  const result = await apiRequest<{ key: string; prefix: string }>({
    apiKey,
    apiUrl: context.apiUrl,
    body: { name },
    method: "POST",
    path: "/v1/api-keys",
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not create a key"
    );
  }

  if (context.json) {
    out(JSON.stringify(result.body, null, 2));

    return 0;
  }

  out(result.body.data.key);
  out("");
  // Not stored: the key in the config is the one this command authenticated
  // with, and silently replacing it would revoke the caller's own footing on
  // their next command in a way they did not ask for.
  out("Shown once. This does not replace your stored key.");

  return 0;
}

async function keysRevoke(
  context: Context,
  apiKey: string,
  reference: string | undefined
): Promise<number> {
  if (reference === undefined) {
    return fail("keys revoke needs a prefix or an id");
  }

  /**
   * Resolve a prefix to an id here rather than in the API.
   *
   * The route takes an id, deliberately: a four-character prefix carries no unique
   * index, and an endpoint that accepted one would sometimes revoke a key the
   * caller did not name. But an id is not what a person has in front of them —
   * the prefix is the part still readable after issue — so the translation belongs
   * on this side, where the ambiguity can be reported instead of guessed.
   */
  const listed = await apiRequest<KeyRow[]>({
    apiKey,
    apiUrl: context.apiUrl,
    path: "/v1/api-keys",
  });

  if (!listed.ok || listed.body.data === null) {
    return reportApiError(
      listed.status,
      listed.body.error?.message,
      "could not list keys"
    );
  }

  const matches = listed.body.data.filter(
    (key) => key.id === reference || key.prefix === reference
  );
  const [match] = matches;

  if (match === undefined) {
    return fail(
      `no key matches "${reference}". \`propgate keys list\` shows every prefix.`
    );
  }

  if (matches.length > 1) {
    process.stderr.write(
      `propgate: "${reference}" matches ${matches.length} keys. Revoke by id instead:\n${matches
        .map((key) => `  ${key.id}  ${key.name}`)
        .join("\n")}\n`
    );

    return EXIT_FAILED;
  }

  const result = await apiRequest<KeyRow>({
    apiKey,
    apiUrl: context.apiUrl,
    method: "DELETE",
    path: `/v1/api-keys/${match.id}`,
  });

  if (!result.ok) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not revoke the key"
    );
  }

  if (context.json) {
    out(JSON.stringify(result.body, null, 2));

    return 0;
  }

  out(
    result.body.meta?.alreadyRevoked === true
      ? `${match.prefix} was already revoked. Nothing changed.`
      : `Revoked ${match.prefix}. It stops working on the next request.`
  );

  return 0;
}

interface DomainRow {
  readonly id: string;
  readonly lastCheckedAt: string | null;
  readonly name: string;
  readonly requirementsMet: number | null;
  readonly requirementsTotal: number | null;
  readonly state: string;
}

async function domainsAdd(
  context: Context,
  apiKey: string,
  name: string | undefined,
  profile: string | undefined,
  externalId: string | undefined
): Promise<number> {
  if (name === undefined) {
    return fail("domains add needs a domain");
  }

  if (profile === undefined) {
    return fail("domains add needs --profile");
  }

  const result = await apiRequest<DomainRow>({
    apiKey,
    apiUrl: context.apiUrl,
    body: {
      ...(externalId === undefined ? {} : { externalId }),
      name,
      profile,
    },
    method: "POST",
    path: "/v1/domains",
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not register the domain"
    );
  }

  if (context.json) {
    out(JSON.stringify(result.body, null, 2));

    return 0;
  }

  out(`${result.body.data.name} registered as ${result.body.data.id}.`);
  // Registration does not touch DNS, which is worth saying: otherwise `state:
  // pending` reads as a failure rather than as "nobody has looked yet".
  out("Nothing has been checked yet — the sweeper will pick it up.");

  return 0;
}

async function domainsList(
  context: Context,
  apiKey: string,
  state: string | undefined
): Promise<number> {
  const result = await apiRequest<DomainRow[]>({
    apiKey,
    apiUrl: context.apiUrl,
    path: `/v1/domains${state === undefined ? "" : `?state=${encodeURIComponent(state)}`}`,
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "could not list domains"
    );
  }

  if (context.json) {
    out(JSON.stringify(result.body, null, 2));

    return 0;
  }

  for (const domain of result.body.data) {
    const met =
      domain.requirementsTotal === null
        ? "not checked"
        : `${domain.requirementsMet}/${domain.requirementsTotal}`;

    out(
      [
        domain.state.padEnd(10),
        domain.name.padEnd(28),
        met.padEnd(12),
        `checked ${when(domain.lastCheckedAt)}`,
      ].join("  ")
    );
  }

  // An empty list is a real answer, and printing nothing looks like a failure.
  if (result.body.data.length === 0) {
    out(
      "No domains yet. Add one with `propgate domains add <domain> --profile <key>`."
    );
  }

  return 0;
}

/**
 * Wrapped so the caller gets a value to switch on, and so `values` stays typed.
 *
 * `parseArgs` derives its return type from the options object, which means the
 * config has to be inline at the call site — the same reason `args.ts` wraps it
 * this way rather than declaring the result type up front.
 */
function readArgs(argv: readonly string[]) {
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

/**
 * Run an account command.
 *
 * Its own `parseArgs` call rather than an extension of the check parser: these
 * flags are disjoint from that command's, and one option table covering both would
 * accept `propgate check example.com --code 123456` as valid.
 */
export async function runAccountCommand(
  argv: readonly string[]
): Promise<number> {
  const read = readArgs(argv);

  if (!read.ok) {
    process.stderr.write(`propgate: ${read.message}\n\n${ACCOUNT_USAGE}`);

    return EXIT_USAGE;
  }

  const { positionals, values } = read.parsed;
  const [command, subcommand, argument] = positionals;

  let context: Context;

  try {
    const resolved = credentials({ apiUrl: values["api-url"] });

    context = {
      apiKey: resolved.apiKey,
      apiUrl: resolved.apiUrl,
      json: values.json === true,
    };
  } catch (cause) {
    return fail((cause as Error).message);
  }

  if (command === "signup") {
    return await signup(context, values.email);
  }

  if (command === "confirm") {
    return await confirm(context, values.email, values.code);
  }

  const apiKey = requireKey(context);

  if (apiKey === null) {
    return EXIT_FAILED;
  }

  if (command === "keys") {
    if (subcommand === "list") {
      return await keysList(context, apiKey);
    }

    if (subcommand === "create") {
      return await keysCreate(context, apiKey, argument);
    }

    if (subcommand === "revoke") {
      return await keysRevoke(context, apiKey, argument);
    }

    process.stderr.write(
      `propgate: keys needs list, create or revoke\n\n${ACCOUNT_USAGE}`
    );

    return EXIT_USAGE;
  }

  if (subcommand === "add") {
    return await domainsAdd(
      context,
      apiKey,
      argument,
      values.profile,
      values["external-id"]
    );
  }

  if (subcommand === "list") {
    return await domainsList(context, apiKey, values.state);
  }

  process.stderr.write(
    `propgate: domains needs add or list\n\n${ACCOUNT_USAGE}`
  );

  return EXIT_USAGE;
}
