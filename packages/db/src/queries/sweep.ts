import { asc, inArray, lte, sql } from "drizzle-orm";
import type { Database } from "../client";
import { domains } from "../schema/domains";

export interface ClaimedDomain {
  readonly id: string;
  readonly tenantId: string;
}

export interface ClaimOptions {
  readonly leaseSeconds: number;
  readonly limit: number;
}

export async function claimDueDomains(
  db: Database,
  options: ClaimOptions,
  now = new Date()
): Promise<readonly ClaimedDomain[]> {
  const leaseUntil = new Date(now.getTime() + options.leaseSeconds * 1000);

  return await db.transaction(async (tx) => {
    const due = await tx
      .select({ id: domains.id, tenantId: domains.tenantId })
      .from(domains)
      .where(lte(domains.nextCheckAt, now))
      .orderBy(asc(domains.nextCheckAt))
      .limit(options.limit)
      .for("update", { skipLocked: true });

    if (due.length === 0) {
      return [];
    }

    await tx
      .update(domains)
      .set({ nextCheckAt: leaseUntil })
      .where(
        inArray(
          domains.id,
          due.map((row) => row.id)
        )
      );

    return due;
  });
}

export async function dueCount(
  db: Database,
  now = new Date()
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(domains)
    .where(lte(domains.nextCheckAt, now));

  return rows[0]?.count ?? 0;
}
