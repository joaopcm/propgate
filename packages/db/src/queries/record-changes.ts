import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { recordChanges } from "../schema/record-changes";

export interface Observation {
  readonly domainId: string;
  /** Null when the record is absent, which is itself a change worth recording. */
  readonly observed: string | null;
  readonly requirementKey: string;
}

/**
 * Append an observation, but only if it differs from the last one.
 *
 * Reads the most recent row for the requirement and compares before writing.
 * The read costs an indexed lookup; the alternative costs a row per
 * requirement per sweep, forever.
 */
export async function recordObservation(
  db: Database,
  input: Observation
): Promise<"changed" | "unchanged"> {
  const [latest] = await db
    .select({ current: recordChanges.current })
    .from(recordChanges)
    .where(
      and(
        eq(recordChanges.domainId, input.domainId),
        eq(recordChanges.requirementKey, input.requirementKey)
      )
    )
    .orderBy(desc(recordChanges.id))
    .limit(1);

  if (latest !== undefined && latest.current === input.observed) {
    return "unchanged";
  }

  await db.insert(recordChanges).values({
    current: input.observed,
    domainId: input.domainId,
    previous: latest?.current ?? null,
    requirementKey: input.requirementKey,
  });

  return "changed";
}
