import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import type { DomainState } from "./domains";
import { domainState, domains } from "./domains";

export interface TransitionEvidence {
  readonly codes?: readonly string[];
  readonly consecutiveFailures: number;
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
