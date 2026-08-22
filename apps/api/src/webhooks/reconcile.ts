import type { Database } from "@propgate/db";
import { pendingDeliveries } from "@propgate/db";
import type { DeliverWebhookPayload } from "@propgate/jobs";
import type { Queue } from "bullmq";

export interface DeliveryReconcileDeps {
  readonly attempts: number;
  readonly batchSize: number;
  readonly db: Database;
  readonly queue: Queue<DeliverWebhookPayload>;
  readonly timeoutMs: number;
}

export function abandonedAfterMs(attempts: number, timeoutMs: number): number {
  const backoffMs = (2 ** attempts - 1) * 1000;
  const timeoutsMs = attempts * timeoutMs;

  return (backoffMs + timeoutsMs) * 3;
}

export async function runDeliveryReconcile(
  deps: DeliveryReconcileDeps,
  now = new Date()
): Promise<number> {
  const olderThan = new Date(
    now.getTime() - abandonedAfterMs(deps.attempts, deps.timeoutMs)
  );
  const owed = await pendingDeliveries(deps.db, {
    limit: deps.batchSize,
    olderThan,
  });

  if (owed.length === 0) {
    return 0;
  }

  await deps.queue.addBulk(
    owed.map((delivery) => ({
      data: { deliveryId: delivery.id, tenantId: delivery.tenantId },
      name: "deliver",
    }))
  );

  return owed.length;
}
