import type { Database } from "@propgate/db";
import { claimDueDomains, dueCount } from "@propgate/db";
import type { CheckDomainPayload } from "@propgate/jobs";
import type { Queue } from "bullmq";

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

  await deps.queue.addBulk(
    claimed.map((domain) => ({
      data: { domainId: domain.id, tenantId: domain.tenantId },
      name: "check",
    }))
  );

  return claimed.length;
}

export async function runReconcile(deps: TickDeps): Promise<number> {
  const due = await dueCount(deps.db);

  if (due === 0) {
    return 0;
  }

  return await runTick(deps);
}
