import type { Database } from "@propgate/db";
import {
  deliveryForAttempt,
  markAttemptFailed,
  markDelivered,
  secretsFrom,
} from "@propgate/db";
import type { DeliverWebhookPayload } from "@propgate/jobs";
import { deliver } from "@propgate/webhooks";

/**
 * One attempt at one delivery, and the ledger updated to match.
 *
 * The retry budget belongs to the queue, so this is told how many attempts are
 * allowed rather than deciding: BullMQ owns the backoff, and duplicating the
 * count here would let the two disagree about when something is dead.
 */

export interface AttemptDeps {
  readonly db: Database;
  readonly timeoutMs: number;
}

export type AttemptResult =
  | { readonly kind: "delivered" }
  | { readonly kind: "gone" }
  /** The caller must throw, so BullMQ schedules the retry. */
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
    // The endpoint was deleted, which cascades to its deliveries. Not an error:
    // the customer removed the thing we were going to send to.
    return { kind: "gone" };
  }

  if (context.status !== "pending") {
    /**
     * Already settled. The reconciler and a live job can both point at one row —
     * that is the accepted cost of at-least-once — and this is where the second
     * one stops instead of delivering a duplicate.
     */
    return { kind: "skipped", reason: `already ${context.status}` };
  }

  if (context.disabledAt !== null) {
    // Disabled between the row being written and this attempt. Sending anyway
    // would ignore the one instruction the customer gave us.
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
    // Read now rather than frozen with the row, so a rotation applies to retries.
    secrets: secretsFrom(context),
    timeoutMs: deps.timeoutMs,
    // Seconds, and stamped per attempt: a receiver enforcing the five-minute
    // tolerance would reject a retry carrying the original timestamp.
    timestamp: Math.floor(Date.now() / 1000),
    url: context.url,
  });

  if (outcome.kind === "delivered") {
    await markDelivered(deps.db, payload.deliveryId);

    return { kind: "delivered" };
  }

  // `permanent` is dead on the first attempt; `retryable` only once the queue's
  // budget is spent. Both end as `failed`, which is what the API surfaces.
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
