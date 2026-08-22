import { sql } from "drizzle-orm";
import type { Database } from "../client";

export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql`truncate table tenants, otp_codes restart identity cascade`
  );
}
