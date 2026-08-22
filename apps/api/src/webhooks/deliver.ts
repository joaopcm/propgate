import type { Database } from "@propgate/db";
import {
  deliveryForAttempt,
  markAttemptFailed,
  markDelivered,
  secretsFrom,
} from "@propgate/db";
import type { DeliverWebhookPayload } from "@propgate/jobs";
import { deliver } from "@propgate/webhooks";

export interface AttemptDeps {
  readonly db: Database;
  readonly timeoutMs: number;
}

export type AttemptResult =
  | { readonly kind: "delivered" }
  | { readonly kind: "gone" }
  | { readonly error: string; readonly kind: "retry" }
  | { readonly error: string; readonly kind: "dead-lettered" }
  | { readonly kind: "skipped"; readonly reason: string };

export async function attemptDelivery(
  deps: AttemptDeps,
  payload: DeliverWebhookPayload,
  attempt: { readonly allowed: number; readonly made: number }
): Promise<AttemptResult> {
  const context = await deliveryForAttempt(deps.db, {
    deliveryId: payload.deliveryId,
    tenantId: payload.tenantId,
  });

  if (context === undefined) {
    return { kind: "gone" };
  }

  if (context.status !== "pending") {
    return { kind: "skipped", reason: `already ${context.status}` };
  }

  if (context.disabledAt !== null) {
    await markAttemptFailed(deps.db, {
      deliveryId: payload.deliveryId,
      error: "the endpoint was disabled before this attempt",
      exhausted: true,
    });

    return { kind: "skipped", reason: "endpoint disabled" };
  }

  const body = JSON.stringify(context.payload);
  const outcome = await deliver({
    body,
    id: payload.deliveryId,
    secrets: secretsFrom(context),
    timeoutMs: deps.timeoutMs,
    timestamp: Math.floor(Date.now() / 1000),
    url: context.url,
  });

  if (outcome.kind === "delivered") {
    await markDelivered(deps.db, payload.deliveryId);

    return { kind: "delivered" };
  }

  const exhausted =
    outcome.kind === "permanent" || attempt.made >= attempt.allowed;

  await markAttemptFailed(deps.db, {
    deliveryId: payload.deliveryId,
    error: outcome.error,
    exhausted,
  });

  return exhausted
    ? { error: outcome.error, kind: "dead-lettered" }
    : { error: outcome.error, kind: "retry" };
}
