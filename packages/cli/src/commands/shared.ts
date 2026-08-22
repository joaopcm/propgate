import type { WebhookEvent } from "@propgate/webhooks";
import type { Choice, Field } from "../command";

const EVENT_HINTS: Record<WebhookEvent, string> = {
  "domain.degraded": "Some vantage points disagree. Possibly nothing is wrong.",
  "domain.failed": "Consecutive failures across vantage points.",
  "domain.recovered": "Back to verified after degraded or failed.",
  "domain.verified": "Verified for the first time.",
};

export const WEBHOOK_EVENTS = Object.keys(
  EVENT_HINTS
) as readonly WebhookEvent[];

export const EVENT_CHOICES: readonly Choice[] = Object.entries(EVENT_HINTS).map(
  ([value, hint]) => ({ hint, value })
);

export const DOMAIN_STATES = [
  "pending",
  "verifying",
  "verified",
  "degraded",
  "failed",
] as const;

export const DELIVERY_STATUSES = ["pending", "delivered", "failed"] as const;

function choices(values: readonly string[]): readonly Choice[] {
  return values.map((value) => ({ value }));
}

export const stateField: Field = {
  choices: choices(DOMAIN_STATES),
  describe: "Only domains in this state.",
  flag: "state",
  kind: "select",
  prompt: "Which state?",
  required: false,
};

export const cursorField: Field = {
  describe: "Start after this id. From meta.nextCursor of a previous page.",
  flag: "cursor",
  kind: "string",
  placeholder: "id",
  prompt: "Start after which id?",
  required: false,
};

export const allField: Field = {
  describe: "Follow the cursor to the end and print every row.",
  flag: "all",
  kind: "boolean",
  prompt: "Fetch every page?",
  required: false,
};

export function limitField(max: number): Field {
  return {
    describe: `How many rows. Up to ${max}.`,
    flag: "limit",
    kind: "string",
    placeholder: "n",
    prompt: "How many rows?",
    required: false,
  };
}

export function positiveInteger(value: string): string | undefined {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0
    ? undefined
    : `"${value}" is not a whole number above zero`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeId(value: string): boolean {
  return UUID.test(value.trim());
}
