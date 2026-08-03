import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { domains } from "./domains";
import { tenants } from "./tenants";

/**
 * Where events go, and what is owed.
 *
 * The split matters: `webhook_endpoints` is configuration a customer edits, and
 * `webhook_deliveries` is the **ledger**. BullMQ is only the attempt mechanism —
 * a delivery row is written before any job is enqueued, so a flushed Redis costs
 * in-flight attempts and never an obligation. That is the same rule as
 * `domains.next_check_at` for the sweeper: Postgres is the truth, Redis is the
 * conveyor belt.
 */

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    /**
     * Set rather than deleted, so a customer can turn an endpoint off without
     * losing the delivery history that points at it. A row that vanishes takes
     * the answer to "what did you try to send me" with it.
     */
    disabledAt: timestamp("disabled_at"),
    /**
     * Which events this endpoint wants. Empty means all of them.
     *
     * A text array rather than a join table: the set is four values, fixed by the
     * taxonomy, and read on every transition. A join here would be a second query
     * on the hot path to model something that cannot grow unboundedly.
     */
    events: text("events").array().notNull().default([]),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    /**
     * The secret being rotated away from, and when it stops being signed with.
     *
     * Two active secrets rather than a hard swap. During the window every request
     * carries both signatures space-separated, so a customer who has redeployed
     * and one who has not are both still verifying successfully. A swap would
     * break whoever had not redeployed, during the one operation you perform
     * precisely because you think a secret leaked.
     */
    previousSecret: text("previous_secret"),
    previousSecretExpiresAt: timestamp("previous_secret_expires_at"),
    secret: text("secret").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
  },
  (table) => [
    // One endpoint per URL per tenant. A partner retrying a create should get the
    // existing row rather than a second endpoint delivering everything twice.
    uniqueIndex("webhook_endpoints_tenant_url_idx").on(
      table.tenantId,
      table.url
    ),
  ]
);

export const deliveryStatus = pgEnum("delivery_status", [
  "pending",
  "delivered",
  "failed",
]);

export type DeliveryStatus = (typeof deliveryStatus.enumValues)[number];

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    /** How many HTTP attempts have been made. Bounded by the queue's retries. */
    attempts: integer("attempts").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    deliveredAt: timestamp("delivered_at"),
    /**
     * Kept without a cascade, unlike most things hanging off a domain.
     *
     * A delivery that failed is a record of something we owed and did not manage
     * to send, and deleting a domain should not erase that: "why did I never get
     * the failure notification for the domain I then deleted" is exactly the
     * question this table exists to answer. Nullable so the domain *can* be
     * deleted.
     */
    domainId: text("domain_id").references(() => domains.id, {
      onDelete: "set null",
    }),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    /** The last error, in the words the receiver or the socket gave us. */
    lastError: text("last_error"),
    /**
     * The exact bytes to send, frozen at the moment the transition happened.
     *
     * Not regenerated at delivery time, which would be the obvious thing and is
     * wrong: a retry three minutes later would describe the domain's *current*
     * state, so a customer could receive a `domain.failed` event whose body says
     * `verified`. The signature covers this body, so it also has to be stable
     * across attempts or every retry would need re-signing.
     */
    payload: jsonb("payload").notNull(),
    status: deliveryStatus("status").default("pending").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (table) => [
    // The listing endpoint: a tenant's deliveries, newest first.
    index("webhook_deliveries_tenant_created_idx").on(
      table.tenantId,
      table.createdAt
    ),
    // The reconciler's query: what is still owed after Redis lost its jobs.
    index("webhook_deliveries_status_created_idx").on(
      table.status,
      table.createdAt
    ),
  ]
);
