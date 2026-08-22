import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { recordChanges } from "../schema/record-changes";

export interface Observation {
  readonly domainId: string;
  readonly observed: string | null;
  readonly requirementKey: string;
}

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
