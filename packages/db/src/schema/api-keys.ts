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

/**
 * Only the hash is stored. `prefix` is the leading characters kept in clear so
 * a key can be identified in a list without being reconstructible from the
 * row — losing the database must not lose the keys.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    /**
     * Who made this key, when that is knowable.
     *
     * **Nullable, and it will stay nullable**, because three real cases have no
     * member to name: keys that predate this column, keys minted by an operator
     * over a shell (`mint.js` — there is no person in that transaction, which is
     * the point of it), and keys created by another key that itself has no
     * creator. A `not null` here would mean inventing an attribution for all
     * three, and an invented one is worse than an absent one — it reads as
     * evidence.
     *
     * `set null` rather than `cascade` on purpose: removing a member must not
     * delete the keys they made. Those keys are what a live integration is
     * authenticating with, and deleting them would take production down as a side
     * effect of tidying up a departure.
     */
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
