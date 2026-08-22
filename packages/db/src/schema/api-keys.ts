import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { tenantMembers } from "./tenant-members";
import { tenants } from "./tenants";

export const apiKeys = pgTable(
  "api_keys",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdByMemberId: text("created_by_member_id").references(
      () => tenantMembers.id,
      { onDelete: "set null" }
    ),
    hashedKey: text("hashed_key").notNull(),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    lastUsedAt: timestamp("last_used_at"),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    revokedAt: timestamp("revoked_at"),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("api_keys_hashed_key_idx").on(table.hashedKey),
    index("api_keys_tenant_id_idx").on(table.tenantId),
  ]
);
