import { runMigrations } from "@propgate/db";
import { requireDatabaseUrl } from "./utils/database-url";

const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? "/app/drizzle";

await runMigrations(requireDatabaseUrl(), MIGRATIONS_DIR);

process.stdout.write(`migrations applied from ${MIGRATIONS_DIR}\n`);
