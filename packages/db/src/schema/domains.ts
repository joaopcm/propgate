import {
  index,
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

/**
 * All five states exist from the first migration.
 *
 * This milestone can only reach `pending`, `verified` and `failed` — checks are
 * synchronous, so nothing observes `verifying`, and `degraded` needs the
 * hysteresis that arrives with the sweeper. They are here so milestone 2 adds a
 * transition rather than migrating an enum under live rows.
 */
export const domainState = pgEnum("domain_state", [
  "pending",
  "verifying",
  "verified",
  "degraded",
  "failed",
]);

export type DomainState = (typeof domainState.enumValues)[number];

export type StoredVerdict = "pass" | "warn" | "indeterminate" | "fail";

/** One requirement's outcome, as stored. Mirrors what the API returns. */
export interface RequirementResult {
  readonly findings: readonly {
    readonly code: string;
    readonly expected?: string;
    readonly observed?: string;
  }[];
  readonly key: string;
  readonly satisfied: boolean;
  readonly verdict: StoredVerdict;
}

export interface DomainResult {
  readonly checkedAt: string;
  readonly requirements: readonly RequirementResult[];
  readonly verdict: StoredVerdict;
}

export const domains = pgTable(
  "domains",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    externalId: text("external_id"),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    /**
     * Updated in place, never a row per check. Invariant 3: logging every check
     * result is 360k rows a day at ten thousand domains.
     */
    lastCheckedAt: timestamp("last_checked_at"),
    lastResult: jsonb("last_result").$type<DomainResult>(),
    name: text("name").notNull(),
    /**
     * Nothing reads this yet. It is the column the sweeper's query will be
     * built on, and adding it later means backfilling every row.
     */
    nextCheckAt: timestamp("next_check_at"),
    /**
     * A profile *version*, and deliberately no cascade: a domain pinned to a
     * version that vanished cannot be re-evaluated, and losing that silently is
     * worse than an error at delete time.
     */
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
    // The sweeper's query, in index form, before the sweeper exists.
    index("domains_state_next_check_at_idx").on(table.state, table.nextCheckAt),
  ]
);
