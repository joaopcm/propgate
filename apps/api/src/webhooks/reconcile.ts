import type { Database } from "@propgate/db";
import { pendingDeliveries } from "@propgate/db";
import type { DeliverWebhookPayload } from "@propgate/jobs";
import type { Queue } from "bullmq";

/**
 * Re-enqueue deliveries Redis lost.
 *
 * The ledger is written before any job, so a flushed Redis leaves rows that are
 * owed and nothing scheduled to send them. Without this they would sit `pending`
 * forever — a webhook product silently owing events is the worst failure mode
 * available to it, because everything looks fine.
 */

export interface DeliveryReconcileDeps {
  readonly attempts: number;
  readonly batchSize: number;
  readonly db: Database;
  readonly queue: Queue<DeliverWebhookPayload>;
  readonly timeoutMs: number;
}

/**
 * How old a pending row must be before it is treated as abandoned.
 *
 * **This is the load-bearing number in this file.** A row being retried right now
 * is also `pending`, so re-enqueueing too eagerly would put a second job beside a
 * live one and deliver the same event twice — `attemptDelivery` skips *settled*
 * rows, and a row mid-retry is not settled, so nothing downstream would catch it.
 *
 * So the window has to exceed the worst case a live retry chain can take, which
 * is computable rather than guessed: the backoff is 1s doubling, so N attempts
 * wait `2^N - 1` seconds in total, and each attempt can also burn the full
 * timeout. Tripled, because being late costs a delay and being early costs a
 * duplicate.
 *
 * Derived rather than a constant so that raising WEBHOOK_ATTEMPTS cannot silently
 * make this unsafe — at five attempts the worst case is about 81 seconds and the
 * window is four minutes; at twenty it would be over twelve days, and the window
 * grows with it instead of quietly starting to double-send.
 */
export function abandonedAfterMs(attempts: number, timeoutMs: number): number {
  const backoffMs = (2 ** attempts - 1) * 1000;
  const timeoutsMs = attempts * timeoutMs;

  return (backoffMs + timeoutsMs) * 3;
}

/** How many deliveries were re-enqueued. Zero on a healthy box, always. */
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
