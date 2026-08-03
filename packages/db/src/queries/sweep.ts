import { asc, inArray, lte, sql } from "drizzle-orm";
import type { Database } from "../client";
import { domains } from "../schema/domains";

/**
 * What the sweeper claims, and how it hands the work back.
 *
 * Postgres decides what is due; Redis only carries the work. Everything here is
 * written so that losing Redis entirely costs in-flight attempts and never an
 * obligation — the next tick re-derives the same list from `next_check_at`.
 */

export interface ClaimedDomain {
  readonly id: string;
  readonly tenantId: string;
}

export interface ClaimOptions {
  /**
   * How long a claim is held before the row becomes claimable again.
   *
   * This is the crash-recovery mechanism and the reason no operator ever has to
   * unstick a domain. A worker that dies mid-check has simply not written a new
   * `next_check_at`; when the lease lapses the row is due again and the next tick
   * picks it up exactly as it would any other.
   *
   * Must comfortably exceed the check budget, or a slow-but-healthy check gets
   * claimed a second time while the first is still running. The budget is 10s, so
   * the default of five minutes is a tripwire rather than a limit.
   */
  readonly leaseSeconds: number;
  readonly limit: number;
}

/**
 * Take the next batch of due domains, and mark them taken atomically.
 *
 * **`for update skip locked`** is what lets more than one worker run without
 * coordination. Two ticks overlapping — which happens on every deploy, and any
 * time a sweep outruns its interval — take disjoint sets instead of both taking
 * the same row and checking it twice. Without `skip locked` the second waits on
 * the first's lock and then re-reads rows the first already claimed.
 *
 * **The transaction is what makes two statements safe.** `for update skip locked`
 * holds its row locks until commit, so between the select and the update no other
 * session can take the same rows — the window that would exist between two
 * autocommitted statements is closed by the transaction rather than by cramming
 * both into one statement.
 *
 * **`next_check_at` moves forward by the lease**, not to null and not to a
 * sentinel. The row stays a normal row that simply is not due yet, so recovery
 * needs no special case.
 *
 * **The claim deliberately does not set `state = 'verifying'`.** Two reasons, and
 * the second is the product one. Mechanically, `nextState` returns the current
 * state for an `indeterminate` verdict, so a check that could not reach the
 * resolver would leave the row in `verifying` permanently — a domain stuck in a
 * transient state forever, which is the worst failure this table can hold.
 * Semantically, a re-check of an established domain is not a period of
 * uncertainty: the domain is still verified while we confirm it, and flipping ten
 * thousand healthy domains to `verifying` every night would make the dashboard
 * lie once a day. In-flight work is visible in Workbench, which is where it
 * belongs. `verifying` remains for a first-verification flow to claim later.
 *
 * Deliberately not filtered by state either — every state has its own cadence and
 * all of them are swept, which is what monitoring means.
 *
 * Returns identifiers only. The worker re-reads the row, because by the time a
 * job runs the row may have been re-profiled or deleted, and acting on a snapshot
 * taken at claim time is how a queue starts disagreeing with the database.
 */
export async function claimDueDomains(
  db: Database,
  options: ClaimOptions,
  now = new Date()
): Promise<readonly ClaimedDomain[]> {
  // Computed here rather than as `now + interval` in SQL: the comparison below is
  // already against the caller's clock, so doing the arithmetic in Postgres would
  // mix two clocks for no gain.
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

/**
 * How many rows are due.
 *
 * The reconciler's input, and it exists because Redis is disposable: a flush
 * loses the enqueued jobs, and the rows they pointed at would then sit due until
 * something noticed. Counting is an index-only scan and turns "did we lose work"
 * into a number rather than a guess.
 */
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
