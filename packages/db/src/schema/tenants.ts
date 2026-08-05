import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

export const tenants = pgTable("tenants", {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  id: text("id")
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  name: text("name").notNull(),
  /**
   * A per-tenant request ceiling, which only ever **raises** the default.
   *
   * Null means the default in `tenant-rate-limit.ts`. It raises rather than
   * lowers because the default has to be safe for a caller nobody has spoken
   * to — anybody with an email address can get a key now — and a vetted partner
   * is then a row update rather than a second tier of constants somebody has to
   * remember to keep in step.
   *
   * Per second, matching the window the limiter actually enforces. A column
   * named for a minute holding a per-second number is the kind of mismatch that
   * gets read wrong once and stays wrong.
   */
  requestQuotaPerSecond: integer("request_quota_per_second"),
});
