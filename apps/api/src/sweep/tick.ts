import type { Database } from "@propgate/db";
import { claimDueDomains, dueCount } from "@propgate/db";
import type { CheckDomainPayload } from "@propgate/jobs";
import type { Queue } from "bullmq";

/**
 * One pass of the sweeper: claim what is due, hand it to the queue.
 *
 * The tick does no DNS itself. That is the whole point of the split — a slow
 * authoritative server delays one `check-domain` job instead of the next tick,
 * and the sweep's cadence stays a property of the scheduler rather than of the
 * worst zone in the batch.
 */

export interface TickDeps {
  readonly batchSize: number;
  readonly db: Database;
  readonly leaseSeconds: number;
  readonly queue: Queue<CheckDomainPayload>;
}

export async function runTick(deps: TickDeps): Promise<number> {
  const claimed = await claimDueDomains(deps.db, {
    leaseSeconds: deps.leaseSeconds,
    limit: deps.batchSize,
  });

  if (claimed.length === 0) {
    return 0;
  }

  /**
   * `addBulk` rather than a loop, and no `jobId`.
   *
   * Deriving `jobId` from the domain id is the obvious idea and it is a trap:
   * BullMQ refuses to add a job whose id already exists, *including* one sitting
   * in the completed set. With retention keeping 25,000 completed jobs, a domain
   * checked daily would have yesterday's job still present and today's add would
   * be silently ignored — the domain simply stops being checked, with no error
   * anywhere.
   *
   * De-duplication belongs in Postgres, where the lease already provides it: a
   * claimed row is not due again for `leaseSeconds`, so a second job for the same
   * domain cannot be created in the first place.
   */
  await deps.queue.addBulk(
    claimed.map((domain) => ({
      data: { domainId: domain.id, tenantId: domain.tenantId },
      name: "check",
    }))
  );

  return claimed.length;
}

/**
 * Re-enqueue work that Redis lost.
 *
 * Redis is the conveyor belt and it is allowed to fail: a flush, a restart
 * without the volume, an eviction we did not anticipate. What that costs is the
 * enqueued jobs, and the rows they pointed at would then sit due until somebody
 * noticed — which, for a monitoring product, means silently monitoring nothing.
 *
 * This is deliberately the same operation as a tick. There is nothing to detect
 * and no reconciliation state to keep: rows that are due get claimed and
 * enqueued, and rows already in flight are not due because they hold a lease. A
 * tick that runs when nothing was lost claims nothing and costs one indexed
 * count.
 */
export async function runReconcile(deps: TickDeps): Promise<number> {
  const due = await dueCount(deps.db);

  if (due === 0) {
    return 0;
  }

  return await runTick(deps);
}
