import type { ApiKeySummary } from "@propgate/db";
import { createDb, listApiKeys, revokeApiKeyByReference } from "@propgate/db";
import { requireDatabaseUrl } from "./utils/database-url";

/**
 * Looking at keys, and taking one away.
 *
 *   node dist/keys.js list
 *   node dist/keys.js revoke pg_live_Ab3x [--force]
 *
 * A bundled entry point rather than an API route. A key that can revoke keys is
 * a privilege-escalation question, and the control plane is deliberately out of
 * scope — but handing an operator raw UPDATE statements against the auth table
 * is how someone eventually forgets a WHERE clause under pressure. This is the
 * middle: the operation, with its two footguns designed out.
 */

const USAGE = `usage:
  node dist/keys.js list
  node dist/keys.js revoke <prefix|id> [--force]
`;

function when(value: Date | null): string {
  return value === null
    ? "never"
    : value.toISOString().slice(0, 16).replace("T", " ");
}

function row(key: ApiKeySummary): string {
  const state = key.revokedAt === null ? "active " : "REVOKED";

  return [
    state,
    key.prefix.padEnd(14),
    key.tenantName.padEnd(20),
    key.name.padEnd(14),
    `used ${when(key.lastUsedAt)}`,
  ].join("  ");
}

const [command, reference] = process.argv.slice(2);
const force = process.argv.includes("--force");
const db = createDb(requireDatabaseUrl(), { maxConnections: 1 });

if (command === "list") {
  const keys = await listApiKeys(db);

  process.stdout.write(
    keys.length === 0
      ? 'no keys yet — mint one with `node dist/mint.js "Tenant name"`\n'
      : `${keys.map(row).join("\n")}\n`
  );
} else if (command === "revoke" && reference !== undefined) {
  const outcome = await revokeApiKeyByReference(db, reference, { force });

  if (outcome.kind === "revoked") {
    process.stdout.write(
      `revoked ${outcome.key.prefix} (${outcome.key.tenantName}). It stops working on the next request.\n`
    );
  } else if (outcome.kind === "already-revoked") {
    process.stdout.write(
      `${outcome.key.prefix} was already revoked at ${when(outcome.key.revokedAt)}. Nothing changed.\n`
    );
  } else if (outcome.kind === "not-found") {
    process.stderr.write(
      `no key matches "${reference}". \`list\` shows every prefix.\n`
    );
    process.exit(1);
  } else if (outcome.kind === "ambiguous") {
    // Name the candidates and their ids, so the next command is obvious.
    process.stderr.write(
      `"${reference}" matches ${outcome.matches.length} keys. Revoke by id instead:\n${outcome.matches
        .map((key) => `  ${key.id}  ${key.tenantName}  ${key.name}`)
        .join("\n")}\n`
    );
    process.exit(1);
  } else {
    process.stderr.write(
      `${outcome.key.prefix} is the last active key for ${outcome.key.tenantName}; revoking it locks them out and there is no un-revoke.\nMint a replacement first, or pass --force if that is what you mean.\n`
    );
    process.exit(1);
  }
} else {
  process.stderr.write(USAGE);
  process.exit(2);
}

await db.$client.end();
