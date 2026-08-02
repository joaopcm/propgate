import { runMigrations } from "@propgate/db";
import { env } from "./env";

/**
 * The deploy-time migration step.
 *
 * A separate entry point rather than something the server does at boot. Boot
 * migrations couple "the schema is current" to "a process started", which is
 * fine with one replica and silently a race the first time there are two — and
 * it means a migration failure looks like a crash loop rather than a failed
 * deploy. Compose runs this to completion before the API starts.
 *
 * The folder is where the Dockerfile puts the SQL, overridable so the same
 * image can be run against a checkout.
 */
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? "/app/drizzle";

await runMigrations(env.DATABASE_URL, MIGRATIONS_DIR);

process.stdout.write(`migrations applied from ${MIGRATIONS_DIR}\n`);
