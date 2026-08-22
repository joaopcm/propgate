import { isNull } from "drizzle-orm";
import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

export const otpCodes = pgTable(
  "otp_codes",
  {
    attempts: integer("attempts").default(0).notNull(),
    codeHash: text("code_hash").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    sentAt: timestamp("sent_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("otp_codes_live_email_idx")
      .on(table.email)
      .where(isNull(table.consumedAt)),
  ]
);
