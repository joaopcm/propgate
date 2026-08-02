import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { runMigrations } from "../migrate";

const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
);

/** Postgres' "database already exists", which is a concurrent create winning. */
const DUPLICATE_DATABASE = "42P04";

function isDuplicateDatabase(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === DUPLICATE_DATABASE
  );
}

/**
 * Create the per-package database if it is not there yet.
 *
 * The compose service ships one database; each package appends its own suffix
 * to it (see `database-url.ts`), so the rest have to be made on first use.
 * Interpolated rather than parameterised because `CREATE DATABASE` takes no
 * parameters — the name comes from our own vitest config, never from input.
 */
async function ensureDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  const admin = new URL(url);

  admin.pathname = "/postgres";

  const client = postgres(admin.toString(), {
    max: 1,
    onnotice: () => undefined,
  });

  try {
    await client.unsafe(`create database "${name.replace(/"/g, '""')}"`);
  } catch (cause) {
    if (!isDuplicateDatabase(cause)) {
      throw cause;
    }
  } finally {
    await client.end();
  }
}

/**
 * Fails loudly when the database is missing, then brings it up to date.
 *
 * The same rule the DNS tier follows: gate on an environment variable rather
 * than on reachability, because a suite that skips when the server is down
 * looks exactly like a suite that passed. When the flag is set and Postgres is
 * not there, say so with the command that fixes it.
 *
 * Migrations run here rather than as a workflow step because the alternative is
 * a suite whose result depends on whether someone remembered `pnpm db:migrate`
 * after pulling, and which fails as `relation "tenants" does not exist` a long
 * way from that cause.
 */
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL;

  if (url === undefined || url === "") {
    throw new Error(
      "PROPGATE_DATABASE=1 but DATABASE_URL is unset. Run `pnpm db:up`."
    );
  }

  try {
    await ensureDatabase(url);
  } catch (cause) {
    throw new Error(`Postgres unreachable at ${url} — run \`pnpm db:up\``, {
      cause,
    });
  }

  const client = postgres(url, { max: 1, onnotice: () => undefined });

  try {
    await client`select 1`;
  } catch (cause) {
    await client.end();

    throw new Error(`Postgres unreachable at ${url} — run \`pnpm db:up\``, {
      cause,
    });
  }

  await client.end();
  await runMigrations(url, MIGRATIONS_FOLDER);
}
