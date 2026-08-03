import { desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import type { DomainState } from "../schema/domains";
import type {
  StoredTransition,
  TransitionEvidence,
} from "../schema/state-transitions";
import { stateTransitions } from "../schema/state-transitions";

/**
 * The audit trail behind every state change.
 *
 * Written before any webhook is sent, so a lost Redis costs an attempt and never
 * the record of what was owed.
 */

export interface TransitionInput {
  readonly domainId: string;
  readonly evidence: TransitionEvidence;
  readonly fromState: DomainState;
  readonly reason: string;
  readonly toState: DomainState;
}

export async function recordTransition(
  db: Database,
  input: TransitionInput
): Promise<StoredTransition> {
  const [row] = await db
    .insert(stateTransitions)
    .values({
      domainId: input.domainId,
      evidence: input.evidence,
      fromState: input.fromState,
      reason: input.reason,
      toState: input.toState,
    })
    .returning();

  if (row === undefined) {
    throw new Error(
      `recording the ${input.fromState} -> ${input.toState} transition for domain ${input.domainId} returned no row`
    );
  }

  return row;
}

/**
 * A domain's transitions, newest first.
 *
 * Newest first, unlike `listDomains`, because nobody reconciles this — they read
 * it to answer "what happened", and the answer is almost always the most recent
 * thing.
 */
export async function domainTransitions(
  db: Database,
  domainId: string,
  limit = 50
): Promise<readonly StoredTransition[]> {
  return await db
    .select()
    .from(stateTransitions)
    .where(eq(stateTransitions.domainId, domainId))
    .orderBy(desc(stateTransitions.createdAt))
    .limit(limit);
}
