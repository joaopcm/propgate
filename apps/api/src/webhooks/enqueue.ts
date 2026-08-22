import type { Database } from "@propgate/db";
import { endpointsForEvent, recordDelivery } from "@propgate/db";
import type { DeliverWebhookPayload } from "@propgate/jobs";
import type { TransitionState } from "@propgate/webhooks";
import { eventForTransition, webhookPayload } from "@propgate/webhooks";
import type { Queue } from "bullmq";

export interface EnqueueDeps {
  readonly db: Database;
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

export async function enqueueForTransition(
  deps: EnqueueDeps,
  notice: TransitionNotice,
  now = new Date()
): Promise<number> {
  const event = eventForTransition(notice.from, notice.to);

  if (event === null) {
    return 0;
  }

  const endpoints = await endpointsForEvent(deps.db, {
    event,
    tenantId: notice.tenantId,
  });

  if (endpoints.length === 0) {
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

  await deps.queue?.addBulk(
    deliveries.map((delivery) => ({
      data: { deliveryId: delivery.id, tenantId: notice.tenantId },
      name: "deliver",
    }))
  );

  return deliveries.length;
}
