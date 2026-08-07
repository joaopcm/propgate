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
    /** The DNS name the finding is about, when it has one. */
    readonly name?: string;
    readonly observed?: string;
  }[];
  readonly key: string;
  readonly satisfied: boolean;
  readonly verdict: StoredVerdict;
}

/** One DNS query a check made, and why. The derivation behind a verdict. */
export interface StoredLookup {
  readonly name: string;
  readonly purpose: string;
  readonly server: string;
  readonly status: string;
  readonly type: number;
}

/**
 * What a domain's own expectations are, keyed by requirement key then field.
 *
 * The values behind a profile's `requiredPerDomain` declarations. Read and
 * written whole — nothing ever wants one field without the rest of the check —
 * which is why this is a document beside `last_result` rather than a table.
 */
export type DomainExpectations = Readonly<
  Record<string, Readonly<Record<string, string>>>
>;

export interface DomainResult {
  readonly checkedAt: string;
  /**
   * Fingerprint of the merged expectation set this verdict was produced against.
   *
   * A stored `fail` is self-documenting: `DKIM_KEY_MISMATCH` carries the
   * expected value in its evidence. A stored `pass` carries nothing, so "you
   * said we were verified on Tuesday" was unanswerable once expectations became
   * mutable. Comparing this to a fresh compile answers it.
   *
   * Merged rather than raw, so it also moves when a *profile literal* changes
   * under a re-point — which no timestamp on the domain would notice. Absent on
   * results stored before this existed.
   */
  readonly expectationsFingerprint?: string;
  /**
   * Every query the check made.
   *
   * Kept because "why did you say that" is the question a disputed verdict
   * produces, and a stored verdict on its own cannot answer it. Measured at
   * 133 bytes per lookup and ten lookups for a full profile, so this takes one
   * stored result from 389 bytes to about 1.7 KB — bounded, updated in place,
   * and never a row per check.
   */
  readonly lookups?: readonly StoredLookup[];
  readonly requirements: readonly RequirementResult[];
  readonly verdict: StoredVerdict;
}

export const domains = pgTable(
  "domains",
  {
    /**
     * When what this domain is judged against last changed.
     *
     * Named for both causes rather than one: an expectations write and a re-point
     * to another profile version both change the effective expectation set, and a
     * column called `expectations_updated_at` would miss the second — which is
     * precisely where the timeline would start claiming the customer's zone moved
     * when it was us that moved.
     *
     * It earns its place twice. It is also the honest `stateSince` for scheduling:
     * before this column the fifteen-minute fast-pending window was measured from
     * `created_at`, so a year-old domain reset to `pending` by a key rotation got
     * the five-minute cadence instead of the thirty-second one, at the exact
     * moment somebody was waiting on the re-check.
     *
     * Nullable, because every row that predates it has never had its config
     * changed and `created_at` is the right answer for those.
     */
    configChangedAt: timestamp("config_changed_at"),
    /**
     * How many definite failures in a row, reset by any passing check.
     *
     * A run, not a total. An `indeterminate` check leaves it exactly as it was —
     * resetting it would mean a broken domain behind a flaky resolver never
     * accumulated enough consecutive failures to be reported, and incrementing it
     * would mean our own resolver's bad minute paged somebody.
     */
    consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    /**
     * The values behind this profile's `requiredPerDomain` declarations.
     *
     * Null and `{}` both mean "nothing supplied", and neither is an error on its
     * own — a profile that declares nothing needs nothing. What makes a missing
     * value loud is the compile, not this column.
     *
     * It lives on the domain rather than in a request body because the sweeper
     * has no request: a job payload carries identifiers only, so an expectation
     * the interactive path could supply and the sweeper could not would mean
     * continuous monitoring silently comparing against nothing.
     */
    expectations: jsonb("expectations").$type<DomainExpectations>(),
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
     * When the sweeper should look at this domain next. The scheduling truth.
     *
     * `defaultNow()` so a newly registered domain is immediately due and gets
     * picked up by the next tick without registration having to know the sweeper
     * exists. `notNull` because a null here would mean "never check this again",
     * which is a state worth being unable to reach by accident — a domain that
     * silently stopped being monitored is the worst failure this product has.
     * Pausing, if it is ever wanted, should be a state rather than an absence.
     */
    nextCheckAt: timestamp("next_check_at").defaultNow().notNull(),
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
    // Listing a tenant's domains filtered by state.
    index("domains_state_next_check_at_idx").on(table.state, table.nextCheckAt),
    /**
     * The claim query: `where next_check_at <= now() order by next_check_at`.
     *
     * A separate index from the composite above, which cannot serve this: it
     * leads with `state`, and the sweeper deliberately does not filter by state
     * — every state gets re-checked on its own cadence, which is the whole point
     * of monitoring rather than verifying once.
     */
    index("domains_next_check_at_idx").on(table.nextCheckAt),
  ]
);
