import postgres from "postgres";

/**
 * Fails loudly when the database is missing.
 *
 * The same rule the DNS tier follows: gate on an environment variable rather
 * than on reachability, because a suite that skips when the server is down
 * looks exactly like a suite that passed. When the flag is set and Postgres is
 * not there, say so with the command that fixes it.
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
    throw new Error(`Postgres unreachable at ${url} — run \`pnpm db:up\``, {
      cause,
    });
  } finally {
    await client.end();
  }
}
