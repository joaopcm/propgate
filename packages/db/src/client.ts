import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
// biome-ignore lint/performance/noNamespaceImport: drizzle takes the schema as a namespace
import * as schema from "./schema";

export function createDb(
  connectionString: string,
  opts?: { maxConnections?: number }
) {
  const client = postgres(connectionString, {
    max: opts?.maxConnections ?? 10,
  });

  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
