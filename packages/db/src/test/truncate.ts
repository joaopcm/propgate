import { sql } from "drizzle-orm";
import type { Database } from "../client";

/**
 * Empty every table between tests.
 *
 * `TRUNCATE ... CASCADE` from the root of the graph rather than a delete per
 * table: one round trip, no foreign-key ordering to keep in step, and it cannot
 * leave half the tables cleared if it fails partway. Everything hangs off
 * `tenants`, so truncating that reaches the rest.
 */
export async function truncateAll(db: Database): Promise<void> {
  await db.execute(sql`truncate table tenants restart identity cascade`);
}
