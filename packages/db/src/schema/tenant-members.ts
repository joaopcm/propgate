import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { tenants } from "./tenants";

/**
 * The humans attached to a tenant. Exactly one, for now.
 *
 * The address deliberately does not live on `tenants`. A tenant is an
 * integration and will eventually have several people on it; an `email` column
 * there is free today and load-bearing the moment members exist, at which point
 * some code reads it as "the owner" and other code ignores it. The address
 * belongs to the person who proved control of it, so it goes on a join table
 * from the start even while that table holds one row per tenant.
 *
 * Roles are a column here later. Invites are a table beside it. Neither
 * disturbs `tenants`, which is the whole point of paying for the join now.
 */
export const tenantMembers = pgTable(
  "tenant_members",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    /** Lowercased and trimmed by the caller, so `A@b.com` is one person. */
    email: text("email").notNull(),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (table) => [
    /**
     * One address, one tenant, globally.
     *
     * This is what keeps signup unambiguous: re-running the flow on a known
     * address needs no "which account did you mean", so no tenant has to be
     * named in a request that is authenticated by a mailbox. When somebody
     * genuinely needs to belong to two tenants, this index is the single thing
     * to drop — and the signup response would then have to carry a tenant,
     * which is a real API change and should be a deliberate one at that point
     * rather than something the schema quietly allowed.
     */
    uniqueIndex("tenant_members_email_idx").on(table.email),
  ]
);
