import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
// biome-ignore lint/performance/noNamespaceImport: drizzle takes the schema as a namespace
import * as schema from "./schema";

/**
 * A connection pool and a typed query builder over it.
 *
 * A factory rather than a module-level singleton: the API process wants one
 * long-lived pool, and every spec wants its own so that closing one cannot
 * strand another. A singleton read from the environment at import time makes
 * both of those the same object.
 */
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
