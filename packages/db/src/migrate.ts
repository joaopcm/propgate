import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Apply pending migrations, then disconnect.
 *
 * Shared by the test global setup and the production migrate step so both take
 * the same path. Uses `drizzle-orm`'s migrator rather than `drizzle-kit`, which
 * keeps the production image free of a build-time dependency it would otherwise
 * carry solely to run four SQL files.
 *
 * The migrations folder is a parameter rather than derived from `import.meta`:
 * this module gets bundled into the API's output, where a path relative to the
 * source tree means nothing. Explicit beats a path that resolves correctly
 * until someone changes the bundler.
 */
export async function runMigrations(
  url: string,
  migrationsFolder: string
): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => undefined });

  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}
