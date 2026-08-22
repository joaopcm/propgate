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

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    disabledAt: timestamp("disabled_at"),
    events: text("events").array().notNull().default([]),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    previousSecret: text("previous_secret"),
    previousSecretExpiresAt: timestamp("previous_secret_expires_at"),
    secret: text("secret").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
  },
  (table) => [
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
    attempts: integer("attempts").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    deliveredAt: timestamp("delivered_at"),
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
    lastError: text("last_error"),
    payload: jsonb("payload").notNull(),
    status: deliveryStatus("status").default("pending").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("webhook_deliveries_tenant_created_idx").on(
      table.tenantId,
      table.createdAt
    ),
    index("webhook_deliveries_status_created_idx").on(
      table.status,
      table.createdAt
    ),
  ]
);
