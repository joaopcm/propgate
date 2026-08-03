/**
 * The four events, and what a customer receives.
 *
 * All four ship, `degraded` included. It is the one whose value I argued against
 * — a webhook meaning "possibly nothing is wrong" trains people to ignore the
 * channel — and the answer to that objection is not to drop it but to fire it
 * **once per episode**, which `applyHysteresis` already guarantees by only
 * reporting a transition when the state actually moved. A domain degraded for a
 * week produces one event, not two thousand.
 */

export const WEBHOOK_EVENTS = [
  "domain.degraded",
  "domain.failed",
  "domain.recovered",
  "domain.verified",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** The five domain states, duplicated here so this package needs no db import. */
export type TransitionState =
  | "degraded"
  | "failed"
  | "pending"
  | "verified"
  | "verifying";

/**
 * Which event a state change means.
 *
 * The interesting case is `-> verified`, which is two different events depending
 * on where it came from. A first success is `domain.verified`; a return from
 * `degraded` or `failed` is `domain.recovered`. Collapsing them would make the
 * two indistinguishable to a customer whose handler wants to send "you're set up"
 * exactly once and "we're back" every time — and getting a welcome email on every
 * recovery is the kind of thing that loses trust in a webhook channel.
 *
 * Returns null when a transition is not worth telling anyone about. Nothing
 * currently produces one, but a state pair that has no customer-facing meaning
 * should be silent rather than forced into the nearest event.
 */
export function eventForTransition(
  from: TransitionState,
  to: TransitionState
): WebhookEvent | null {
  if (to === "degraded") {
    return "domain.degraded";
  }

  if (to === "failed") {
    return "domain.failed";
  }

  if (to === "verified") {
    return from === "degraded" || from === "failed"
      ? "domain.recovered"
      : "domain.verified";
  }

  // `pending` and `verifying` are internal. A customer does not need to hear that
  // we are about to look at something.
  return null;
}

export interface WebhookPayload {
  readonly created_at: string;
  readonly data: {
    readonly domain: string;
    readonly external_id: string | null;
    readonly id: string;
    readonly previous_state: TransitionState;
    /** Why it moved, in the words the audit trail already uses. */
    readonly reason: string;
    readonly state: TransitionState;
  };
  readonly type: WebhookEvent;
}

/**
 * `snake_case` on the wire, unlike every internal type here.
 *
 * Deliberate and worth the inconsistency: this is the one shape that is a public
 * contract with other people's code, it has to match what the docs show, and
 * `snake_case` is what the Svix ecosystem and most webhook consumers expect.
 * Renaming a field later is a breaking change for every customer at once, so the
 * convention is chosen for them rather than for us.
 */
export function webhookPayload(input: {
  readonly createdAt: Date;
  readonly domain: string;
  readonly domainId: string;
  readonly event: WebhookEvent;
  readonly externalId: string | null;
  readonly from: TransitionState;
  readonly reason: string;
  readonly to: TransitionState;
}): WebhookPayload {
  return {
    created_at: input.createdAt.toISOString(),
    data: {
      domain: input.domain,
      external_id: input.externalId,
      id: input.domainId,
      previous_state: input.from,
      reason: input.reason,
      state: input.to,
    },
    type: input.event,
  };
}
