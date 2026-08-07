import type { WebhookEvent } from "@propgate/webhooks";
import type { Choice, Field } from "../command";

/**
 * The enum values, the pieces of a `Field` that repeat, and the small helpers
 * every command family reaches for.
 */

/**
 * Adding a fifth webhook event breaks `tsc --noEmit`.
 *
 * A `Record` keyed by the type rather than a bare array, which is the same trick
 * `REQUIREMENT_TYPES` uses in the docs app: an array would only catch a *removed*
 * event, and the failure mode worth catching is a new one nobody offered here.
 *
 * `@propgate/webhooks` is a **type-only** devDependency. It has no dependencies of
 * its own and the import is erased at build, so the published tarball is unchanged.
 */
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

/**
 * The five domain states, in the order the API lists them.
 *
 * Written out rather than imported from `@propgate/db`, which is where the enum
 * actually lives. That package pulls in Drizzle and Postgres, and making the
 * published MIT CLI typecheck against the database layer to borrow five strings
 * is a worse trade than restating them next to a pointer at the original:
 * `apps/api/src/routes/domains.ts`, `DOMAIN_STATES`.
 */
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

/** A whole positive number, or a complaint. Rejected here so nobody pages by "abc". */
export function positiveInteger(value: string): string | undefined {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0
    ? undefined
    : `"${value}" is not a whole number above zero`;
}

/**
 * Domain ids are uuidv7 and domain names need at least two labels, so nothing a
 * caller types can be read as both. That is what lets `check` tell them apart
 * without guessing.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeId(value: string): boolean {
  return UUID.test(value.trim());
}
