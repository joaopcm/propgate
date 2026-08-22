import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { runMigrations } from "../migrate";

const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
);

const DUPLICATE_DATABASE = "42P04";

function isDuplicateDatabase(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === DUPLICATE_DATABASE
  );
}

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
