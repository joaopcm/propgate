import { apiRequest } from "../client";
import type { Command, Input } from "../command";
import { EXIT_PROBLEM } from "../exit";
import { type Context, fail, json, out, reportApiError } from "../output";
import { table, when } from "../table";

/** `GET/POST /v1/api-keys` and `DELETE /v1/api-keys/:id`. */

interface KeyRow {
  readonly createdAt: string;
  readonly id: string;
  readonly lastUsedAt: string | null;
  readonly name: string;
  readonly prefix: string;
  readonly revoked: boolean;
}

async function list(_input: Input, context: Context): Promise<number> {
  const result = await apiRequest<KeyRow[]>({
    apiKey: context.apiKey,
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
    return json(result.body);
  }

  if (result.body.data.length === 0) {
    out("No keys. Create one with `propgate keys create <name>`.");

    return 0;
  }

  for (const line of table(
    result.body.data.map((key) => [
      key.revoked ? "REVOKED" : "active",
      key.prefix,
      key.name,
      `used ${when(key.lastUsedAt)}`,
    ])
  )) {
    out(line);
  }

  return 0;
}

async function create(input: Input, context: Context): Promise<number> {
  const result = await apiRequest<{ key: string; prefix: string }>({
    apiKey: context.apiKey,
    apiUrl: context.apiUrl,
    body: { name: input.needPositional() },
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
    return json(result.body);
  }

  out(result.body.data.key);
  out("");
  // Not stored: the key in the config is the one this command authenticated
  // with, and silently replacing it would revoke the caller's own footing on
  // their next command in a way they did not ask for.
  out("Shown once. This does not replace your stored key.");

  return 0;
}

async function revoke(input: Input, context: Context): Promise<number> {
  const reference = input.needPositional();

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
    apiKey: context.apiKey,
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

    return EXIT_PROBLEM;
  }

  const result = await apiRequest<KeyRow>({
    apiKey: context.apiKey,
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
    return json(result.body);
  }

  out(
    result.body.meta?.alreadyRevoked === true
      ? `${match.prefix} was already revoked. Nothing changed.`
      : `Revoked ${match.prefix}. It stops working on the next request.`
  );

  return 0;
}

export const keysCommands: readonly Command[] = [
  {
    authenticated: true,
    fields: [],
    networked: true,
    path: ["keys", "list"],
    run: list,
    summary:
      "Your keys, oldest first, revoked ones included. Prefixes only — no endpoint returns a secret.",
  },
  {
    authenticated: true,
    examples: ["propgate keys create ci"],
    fields: [],
    networked: true,
    path: ["keys", "create"],
    positional: {
      describe: "What to call it.",
      name: "name",
      prompt: "What should this key be called?",
      required: true,
    },
    run: create,
    summary: "Create a key. The secret is returned once and never again.",
  },
  {
    authenticated: true,
    examples: ["propgate keys revoke pg_live_Ab3x"],
    fields: [],
    networked: true,
    path: ["keys", "revoke"],
    positional: {
      describe:
        "The prefix from `keys list`, or the full id. An ambiguous prefix is refused rather than guessed.",
      name: "prefix|id",
      prompt: "Which key? Give its prefix or id",
      required: true,
    },
    run: revoke,
    summary:
      "Revoke a key. Takes effect on the next request. Your last active key is refused.",
  },
];
