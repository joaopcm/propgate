export const WEBHOOK_EVENTS = [
  "domain.degraded",
  "domain.failed",
  "domain.recovered",
  "domain.verified",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export type TransitionState =
  | "degraded"
  | "failed"
  | "pending"
  | "verified"
  | "verifying";

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

  return null;
}

export interface WebhookPayload {
  readonly created_at: string;
  readonly data: {
    readonly domain: string;
    readonly external_id: string | null;
    readonly id: string;
    readonly previous_state: TransitionState;
    readonly reason: string;
    readonly state: TransitionState;
  };
  readonly type: WebhookEvent;
}

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
