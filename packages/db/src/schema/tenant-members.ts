import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { tenants } from "./tenants";

export const tenantMembers = pgTable(
  "tenant_members",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    email: text("email").notNull(),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (table) => [uniqueIndex("tenant_members_email_idx").on(table.email)]
);
