import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { tenants } from "./tenants";

/**
 * Only the hash is stored. `prefix` is the leading characters kept in clear so
 * a key can be identified in a list without being reconstructible from the
 * row — losing the database must not lose the keys.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
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
