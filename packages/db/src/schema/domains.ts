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
import { profiles } from "./profiles";
import { tenants } from "./tenants";

export const domainState = pgEnum("domain_state", [
  "pending",
  "verifying",
  "verified",
  "degraded",
  "failed",
]);

export type DomainState = (typeof domainState.enumValues)[number];

export type StoredVerdict = "pass" | "warn" | "indeterminate" | "fail";

export interface RequirementResult {
  readonly findings: readonly {
    readonly code: string;
    readonly expected?: string;
    readonly name?: string;
    readonly observed?: string;
  }[];
  readonly key: string;
  readonly satisfied: boolean;
  readonly verdict: StoredVerdict;
}

export interface StoredLookup {
  readonly name: string;
  readonly purpose: string;
  readonly server: string;
  readonly status: string;
  readonly type: number;
}

export type DomainExpectations = Readonly<
  Record<string, Readonly<Record<string, string>>>
>;

export interface DomainResult {
  readonly checkedAt: string;
  readonly expectationsFingerprint?: string;
  readonly lookups?: readonly StoredLookup[];
  readonly requirements: readonly RequirementResult[];
  readonly verdict: StoredVerdict;
}

export const domains = pgTable(
  "domains",
  {
    configChangedAt: timestamp("config_changed_at"),
    consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expectations: jsonb("expectations").$type<DomainExpectations>(),
    externalId: text("external_id"),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    lastCheckedAt: timestamp("last_checked_at"),
    lastResult: jsonb("last_result").$type<DomainResult>(),
    name: text("name").notNull(),
    nextCheckAt: timestamp("next_check_at").defaultNow().notNull(),
    profileVersionId: text("profile_version_id")
      .notNull()
      .references(() => profiles.id),
    state: domainState("state").default("pending").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("domains_tenant_name_idx").on(table.tenantId, table.name),
    uniqueIndex("domains_tenant_external_id_idx").on(
      table.tenantId,
      table.externalId
    ),
    index("domains_state_next_check_at_idx").on(table.state, table.nextCheckAt),
    index("domains_next_check_at_idx").on(table.nextCheckAt),
  ]
);
