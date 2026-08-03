import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import type { DomainState } from "./domains";
import { domainState, domains } from "./domains";

/**
 * Every time a domain actually moved, and the evidence that moved it.
 *
 * **This is not an observation log.** Invariant 3 bans a row per check because
 * that is 360k rows a day at ten thousand domains — but a *transition* is a
 * change, so it belongs under that invariant rather than fighting it. A domain
 * transitions a handful of times in its life; a domain that stays degraded for a
 * week writes one row, not two thousand.
 *
 * It exists because the hysteresis thresholds are unmeasured guesses. The first
 * false alarm has to be auditable afterwards or the receipt never arrives and
 * the numbers stay guesses forever — so the per-vantage verdicts that fired the
 * transition are stored with it. Without this, "why did you page me" has no
 * answer once `last_result` has been overwritten by the next check.
 *
 * It is also what Phase 5 reads to decide which webhooks are owed, which is why
 * a row is written before anything is sent.
 */

/** What each vantage point concluded at the moment a transition fired. */
export interface TransitionEvidence {
  /** The diagnosis codes on the check that caused this, for triage. */
  readonly codes?: readonly string[];
  /** The consecutive-failure count that crossed the threshold. */
  readonly consecutiveFailures: number;
  /** One entry per vantage point: the address and the verdict it produced. */
  readonly vantages?: readonly {
    readonly server: string;
    readonly verdict: string;
  }[];
  readonly verdict: string;
}

export const stateTransitions = pgTable(
  "state_transitions",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    domainId: text("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    evidence: jsonb("evidence").$type<TransitionEvidence>(),
    fromState: domainState("from_state").notNull(),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    /** A sentence, because a human reads this when something went wrong. */
    reason: text("reason").notNull(),
    toState: domainState("to_state").notNull(),
  },
  (table) => [
    index("state_transitions_domain_created_idx").on(
      table.domainId,
      table.createdAt
    ),
  ]
);

export interface StoredTransition {
  readonly createdAt: Date;
  readonly evidence: TransitionEvidence | null;
  readonly fromState: DomainState;
  readonly id: string;
  readonly reason: string;
  readonly toState: DomainState;
}
