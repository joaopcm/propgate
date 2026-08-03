import type { WebhookEvent } from "@propgate/webhooks";
import { TOLERANCE_SECONDS, WEBHOOK_EVENTS } from "@propgate/webhooks";

/**
 * The published webhook reference, keyed by the code it describes.
 *
 * `Record<WebhookEvent, …>` makes a new event without documentation a `tsc`
 * error, which is the same trick `api.ts` uses for check kinds. An event a
 * customer receives and cannot look up is a support ticket we wrote ourselves.
 */

export interface EventDoc {
  readonly fires: string;
  readonly summary: string;
}

export const EVENTS: Record<WebhookEvent, EventDoc> = {
  "domain.degraded": {
    fires:
      "on the first definite failure, once per episode — not once per check while it stays degraded",
    summary:
      "Something is wrong, but not yet confirmed. Show it; do not page anyone on it.",
  },
  "domain.failed": {
    fires:
      "when consecutive failures reach the configured threshold, which is three by default",
    summary:
      "The failure persisted across consecutive checks. This is the one worth acting on.",
  },
  "domain.recovered": {
    fires: "on the first passing check after degraded or failed",
    summary:
      "A domain that was degraded or failed is verified again. Distinct from domain.verified so a first-time welcome is not sent on every recovery.",
  },
  "domain.verified": {
    fires: "on the first passing check for a domain that has never verified",
    summary: "Setup is complete. Sent once, not on later recoveries.",
  },
};

export const EVENT_NAMES = WEBHOOK_EVENTS;

/** Quoted from the signing code so the docs cannot state a different tolerance. */
export const TIMESTAMP_TOLERANCE_SECONDS = TOLERANCE_SECONDS;
