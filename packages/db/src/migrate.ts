import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

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
