import { isNull } from "drizzle-orm";
import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

/**
 * One live confirmation code per address, stored as a hash.
 *
 * **A hash, never the code.** We never need to display it — the only operation is
 * "does this input match" — and a leaked database must not be a way into every
 * pending account.
 *
 * Consumed rows are kept rather than deleted: "somebody confirmed this address
 * three weeks ago" is the only evidence available if a signup is ever disputed,
 * and the table is one short row per confirmation.
 */
export const otpCodes = pgTable(
  "otp_codes",
  {
    /**
     * How many wrong guesses this code has taken.
     *
     * The brute-force bound, and the reason six digits is safe: 10^6 is minutes
     * of guessing without a cap and unreachable with one.
     */
    attempts: integer("attempts").default(0).notNull(),
    codeHash: text("code_hash").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    /** Lowercased and trimmed by the caller, so `A@b.com` is one account. */
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    /** When the code was last mailed, which is what the cooldown compares. */
    sentAt: timestamp("sent_at").defaultNow().notNull(),
  },
  (table) => [
    /**
     * One *live* code per address.
     *
     * Partial, so consumed rows accumulate freely while a request storm cannot
     * fan an address out into a hundred valid codes. This index is the whole
     * anti-abuse mechanism on the store side — the route's per-IP limiter guards
     * the mail, and this guards the credential.
     */
    uniqueIndex("otp_codes_live_email_idx")
      .on(table.email)
      .where(isNull(table.consumedAt)),
  ]
);
