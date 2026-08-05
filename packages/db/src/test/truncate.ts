import { sql } from "drizzle-orm";
import type { Database } from "../client";

/**
 * Empty every table between tests.
 *
 * `TRUNCATE ... CASCADE` from the root of the graph rather than a delete per
 * table: one round trip, no foreign-key ordering to keep in step, and it cannot
 * leave half the tables cleared if it fails partway.
 *
 * Almost everything hangs off `tenants`, so truncating that reaches it. The
 * exception is `otp_codes`, which has no tenant to hang off: a code is issued
 * before any account exists, which is the whole point of it. So it has to be
 * named. Naming it here rather than leaving it to each spec keeps this function's
 * promise true; the one spec that remembered to delete it by hand was one test
 * away from the next one that would not have.
 */
export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql`truncate table tenants, otp_codes restart identity cascade`
  );
}
