import type { Database } from "@propgate/db";
import { endpointsForEvent, recordDelivery } from "@propgate/db";
import type { DeliverWebhookPayload } from "@propgate/jobs";
import type { TransitionState } from "@propgate/webhooks";
import { eventForTransition, webhookPayload } from "@propgate/webhooks";
import type { Queue } from "bullmq";

/**
 * Turn a state change into deliveries that are owed.
 *
 * Row first, job second, always. A job without a row is an obligation that
 * disappears when Redis does; a row without a job is picked up by the reconciler.
 * Only one of those two orderings is recoverable.
 */

export interface EnqueueDeps {
  readonly db: Database;
  /**
   * Optional, and the asymmetry is the point.
   *
   * The ledger row is the obligation and is always written; the job is only how
   * an attempt gets scheduled promptly. Without a queue the rows stay `pending`
   * and are picked up by the reconciler, which is exactly what happens anyway if
   * Redis is flushed a second after enqueueing. So a caller with no queue is
   * slower, never wrong — and specs that do not want Redis stay honest rather
   * than skipping the write.
   */
  readonly queue?: Queue<DeliverWebhookPayload>;
}

export interface TransitionNotice {
  readonly domain: string;
  readonly domainId: string;
  readonly externalId: string | null;
  readonly from: TransitionState;
  readonly reason: string;
  readonly tenantId: string;
  readonly to: TransitionState;
}

/** How many deliveries were recorded. Zero is a normal, common answer. */
export async function enqueueForTransition(
  deps: EnqueueDeps,
  notice: TransitionNotice,
  now = new Date()
): Promise<number> {
  const event = eventForTransition(notice.from, notice.to);

  if (event === null) {
    // An internal state change. Nothing a customer needs to hear about.
    return 0;
  }

  const endpoints = await endpointsForEvent(deps.db, {
    event,
    tenantId: notice.tenantId,
  });

  if (endpoints.length === 0) {
    // A tenant with no endpoints, or none subscribed to this event. Overwhelmingly
    // the common case early on, and it must cost one indexed query and nothing
    // else.
    return 0;
  }

  const payload = webhookPayload({
    createdAt: now,
    domain: notice.domain,
    domainId: notice.domainId,
    event,
    externalId: notice.externalId,
    from: notice.from,
    reason: notice.reason,
    to: notice.to,
  });

  const deliveries = await Promise.all(
    endpoints.map((endpoint) =>
      recordDelivery(deps.db, {
        domainId: notice.domainId,
        endpointId: endpoint.id,
        event,
        payload,
        tenantId: notice.tenantId,
      })
    )
  );

  /**
   * Enqueued after every row is committed.
   *
   * A worker is fast enough to pick a job up before a later `recordDelivery` in
   * this same batch has returned, so enqueueing inside the loop above would let a
   * job run against a row that is not yet visible to it.
   */
  await deps.queue?.addBulk(
    deliveries.map((delivery) => ({
      data: { deliveryId: delivery.id, tenantId: notice.tenantId },
      name: "deliver",
    }))
  );

  return deliveries.length;
}
