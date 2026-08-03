import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "../client";
import type { DeliveryStatus } from "../schema/webhooks";
import { webhookDeliveries, webhookEndpoints } from "../schema/webhooks";

/**
 * Endpoints and the delivery ledger.
 *
 * A delivery row exists before a job does. Everything here is written so that the
 * question "what do we still owe" is answerable from Postgres alone.
 */

export interface EndpointRow {
  readonly createdAt: Date;
  readonly disabledAt: Date | null;
  readonly events: readonly string[];
  readonly id: string;
  readonly url: string;
}

export type CreateEndpointOutcome =
  | { readonly endpoint: EndpointRow; readonly kind: "created" }
  | { readonly endpoint: EndpointRow; readonly kind: "existing" };

const ENDPOINT_COLUMNS = {
  createdAt: webhookEndpoints.createdAt,
  disabledAt: webhookEndpoints.disabledAt,
  events: webhookEndpoints.events,
  id: webhookEndpoints.id,
  url: webhookEndpoints.url,
};

/**
 * Create, or hand back the one that is already there.
 *
 * Idempotent on `(tenant_id, url)` for the same reason `registerDomain` is: a
 * partner's retry must not produce a second endpoint that delivers everything
 * twice. The secret is *not* rotated on an existing row — a retry is not a
 * request to invalidate whatever the customer already stored.
 */
export async function createEndpoint(
  db: Database,
  input: {
    readonly events: readonly string[];
    readonly secret: string;
    readonly tenantId: string;
    readonly url: string;
  }
): Promise<CreateEndpointOutcome> {
  const [created] = await db
    .insert(webhookEndpoints)
    .values({
      events: [...input.events],
      secret: input.secret,
      tenantId: input.tenantId,
      url: input.url,
    })
    .onConflictDoNothing({
      target: [webhookEndpoints.tenantId, webhookEndpoints.url],
    })
    .returning(ENDPOINT_COLUMNS);

  if (created !== undefined) {
    return { endpoint: created, kind: "created" };
  }

  const [existing] = await db
    .select(ENDPOINT_COLUMNS)
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.tenantId, input.tenantId),
        eq(webhookEndpoints.url, input.url)
      )
    )
    .limit(1);

  if (existing === undefined) {
    throw new Error(
      `creating the endpoint for ${input.url} conflicted, but no existing row was found — the unique index and this query disagree`
    );
  }

  return { endpoint: existing, kind: "existing" };
}

export async function listEndpoints(
  db: Database,
  tenantId: string
): Promise<readonly EndpointRow[]> {
  return await db
    .select(ENDPOINT_COLUMNS)
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.tenantId, tenantId))
    .orderBy(webhookEndpoints.id);
}

/**
 * Every secret an endpoint should currently sign with, newest first.
 *
 * One normally, two during a rotation window. The expiry is compared here rather
 * than by a cleanup job, so a lapsed secret stops being signed with the moment it
 * lapses even if nothing has swept the table — a rotation window that quietly
 * outlives its expiry because a cron did not run is the kind of thing nobody
 * notices until an audit.
 */
export async function activeSecrets(
  db: Database,
  input: { readonly endpointId: string; readonly tenantId: string },
  now = new Date()
): Promise<readonly string[]> {
  const [row] = await db
    .select({
      previousSecret: webhookEndpoints.previousSecret,
      previousSecretExpiresAt: webhookEndpoints.previousSecretExpiresAt,
      secret: webhookEndpoints.secret,
    })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.id, input.endpointId),
        eq(webhookEndpoints.tenantId, input.tenantId)
      )
    )
    .limit(1);

  if (row === undefined) {
    return [];
  }

  const previousIsLive =
    row.previousSecret !== null &&
    row.previousSecretExpiresAt !== null &&
    row.previousSecretExpiresAt > now;

  return previousIsLive && row.previousSecret !== null
    ? [row.secret, row.previousSecret]
    : [row.secret];
}

/**
 * Move the current secret aside and install a new one.
 *
 * The old secret keeps working until `expiresAt`, which is the whole point. A
 * second rotation inside a window overwrites the *older* of the two rather than
 * chaining a third: two is the documented contract, and silently keeping three
 * would mean a secret a customer believes is dead is still being accepted.
 */
export async function rotateSecret(
  db: Database,
  input: {
    readonly endpointId: string;
    readonly expiresAt: Date;
    readonly secret: string;
    readonly tenantId: string;
  }
): Promise<boolean> {
  const updated = await db
    .update(webhookEndpoints)
    .set({
      previousSecret: sql`${webhookEndpoints.secret}`,
      previousSecretExpiresAt: input.expiresAt,
      secret: input.secret,
    })
    .where(
      and(
        eq(webhookEndpoints.id, input.endpointId),
        eq(webhookEndpoints.tenantId, input.tenantId)
      )
    )
    .returning({ id: webhookEndpoints.id });

  return updated.length > 0;
}

export async function deleteEndpoint(
  db: Database,
  input: { readonly endpointId: string; readonly tenantId: string }
): Promise<boolean> {
  const deleted = await db
    .delete(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.id, input.endpointId),
        eq(webhookEndpoints.tenantId, input.tenantId)
      )
    )
    .returning({ id: webhookEndpoints.id });

  return deleted.length > 0;
}

/**
 * Which endpoints want an event.
 *
 * An empty `events` array means "all of them", which is the useful default for a
 * partner who just wants everything. Disabled endpoints are excluded here rather
 * than filtered later, so a disabled endpoint accrues no delivery rows at all —
 * turning one off should stop the obligation, not queue it up.
 */
export async function endpointsForEvent(
  db: Database,
  input: { readonly event: string; readonly tenantId: string }
): Promise<readonly { readonly id: string; readonly url: string }[]> {
  return await db
    .select({ id: webhookEndpoints.id, url: webhookEndpoints.url })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.tenantId, input.tenantId),
        isNull(webhookEndpoints.disabledAt),
        or(
          sql`cardinality(${webhookEndpoints.events}) = 0`,
          sql`${input.event} = any(${webhookEndpoints.events})`
        )
      )
    );
}

export interface DeliveryRow {
  readonly attempts: number;
  readonly createdAt: Date;
  readonly deliveredAt: Date | null;
  readonly domainId: string | null;
  readonly endpointId: string;
  readonly event: string;
  readonly id: string;
  readonly lastError: string | null;
  readonly payload: unknown;
  readonly status: DeliveryStatus;
}

const DELIVERY_COLUMNS = {
  attempts: webhookDeliveries.attempts,
  createdAt: webhookDeliveries.createdAt,
  deliveredAt: webhookDeliveries.deliveredAt,
  domainId: webhookDeliveries.domainId,
  endpointId: webhookDeliveries.endpointId,
  event: webhookDeliveries.event,
  id: webhookDeliveries.id,
  lastError: webhookDeliveries.lastError,
  payload: webhookDeliveries.payload,
  status: webhookDeliveries.status,
};

/**
 * Record what is owed. Called before anything is enqueued.
 *
 * The payload is frozen here rather than rebuilt at delivery time: a retry
 * minutes later must describe the state that fired the event, not the state the
 * domain has drifted to since, and the signature covers these exact bytes.
 */
export async function recordDelivery(
  db: Database,
  input: {
    readonly domainId: string | null;
    readonly endpointId: string;
    readonly event: string;
    readonly payload: unknown;
    readonly tenantId: string;
  }
): Promise<DeliveryRow> {
  const [row] = await db
    .insert(webhookDeliveries)
    .values({
      domainId: input.domainId,
      endpointId: input.endpointId,
      event: input.event,
      payload: input.payload,
      tenantId: input.tenantId,
    })
    .returning(DELIVERY_COLUMNS);

  if (row === undefined) {
    throw new Error(
      `recording the ${input.event} delivery for endpoint ${input.endpointId} returned no row`
    );
  }

  return row;
}

export async function markDelivered(
  db: Database,
  deliveryId: string,
  now = new Date()
): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({
      attempts: sql`${webhookDeliveries.attempts} + 1`,
      deliveredAt: now,
      lastError: null,
      status: "delivered",
    })
    .where(eq(webhookDeliveries.id, deliveryId));
}

/**
 * Record a failed attempt.
 *
 * `exhausted` distinguishes "will be retried" from "dead-lettered", and it is the
 * caller's decision because the retry budget belongs to the queue. A row left
 * `pending` is one the reconciler may pick up; `failed` is final and is what the
 * API surfaces when a customer asks why a webhook never arrived.
 */
export async function markAttemptFailed(
  db: Database,
  input: {
    readonly deliveryId: string;
    readonly error: string;
    readonly exhausted: boolean;
  }
): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({
      attempts: sql`${webhookDeliveries.attempts} + 1`,
      lastError: input.error,
      ...(input.exhausted ? { status: "failed" as const } : {}),
    })
    .where(eq(webhookDeliveries.id, input.deliveryId));
}

export interface DeliveryPage {
  readonly deliveries: readonly DeliveryRow[];
  readonly nextCursor: string | null;
}

/**
 * A tenant's deliveries, newest first, by keyset.
 *
 * Newest first because nobody reconciles this list — they read it to find out why
 * something did not arrive, and that is almost always recent. Descending on a
 * uuidv7 means `id < cursor` is still an index seek, so depth costs nothing.
 */
export async function listDeliveries(
  db: Database,
  tenantId: string,
  options: {
    readonly cursor?: string;
    readonly limit: number;
    readonly status?: DeliveryStatus;
  }
): Promise<DeliveryPage> {
  const filters = [eq(webhookDeliveries.tenantId, tenantId)];

  if (options.cursor !== undefined) {
    filters.push(lt(webhookDeliveries.id, options.cursor));
  }

  if (options.status !== undefined) {
    filters.push(eq(webhookDeliveries.status, options.status));
  }

  const rows = await db
    .select(DELIVERY_COLUMNS)
    .from(webhookDeliveries)
    .where(and(...filters))
    .orderBy(desc(webhookDeliveries.id))
    .limit(options.limit + 1);

  const deliveries = rows.slice(0, options.limit);

  return {
    deliveries,
    nextCursor:
      rows.length > options.limit ? (deliveries.at(-1)?.id ?? null) : null,
  };
}

/**
 * Deliveries still owed, oldest first.
 *
 * The reconciler's input, and the counterpart to `dueCount` for the sweeper: if
 * Redis lost the jobs, these rows are how the work is re-derived. Oldest first so
 * a backlog drains in the order it accrued rather than starving the earliest
 * events.
 */
export async function pendingDeliveries(
  db: Database,
  options: { readonly limit: number; readonly olderThan?: Date }
): Promise<readonly { readonly id: string; readonly tenantId: string }[]> {
  const filters = [eq(webhookDeliveries.status, "pending")];

  if (options.olderThan !== undefined) {
    filters.push(lt(webhookDeliveries.createdAt, options.olderThan));
  }

  return await db
    .select({
      id: webhookDeliveries.id,
      tenantId: webhookDeliveries.tenantId,
    })
    .from(webhookDeliveries)
    .where(and(...filters))
    .orderBy(webhookDeliveries.createdAt)
    .limit(options.limit);
}
