import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
);

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

  const client = postgres(url, { max: 1, onnotice: () => undefined });

  try {
    await client`select 1`;
  } catch (cause) {
    await client.end();

    throw new Error(`Postgres unreachable at ${url} — run \`pnpm db:up\``, {
      cause,
    });
  }

  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}
