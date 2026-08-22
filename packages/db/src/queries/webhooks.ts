import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "../client";
import type { DeliveryStatus } from "../schema/webhooks";
import { webhookDeliveries, webhookEndpoints } from "../schema/webhooks";

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

export async function endpointById(
  db: Database,
  input: { readonly endpointId: string; readonly tenantId: string }
): Promise<EndpointRow | undefined> {
  const [row] = await db
    .select(ENDPOINT_COLUMNS)
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.id, input.endpointId),
        eq(webhookEndpoints.tenantId, input.tenantId)
      )
    )
    .limit(1);

  return row;
}

export async function updateEndpoint(
  db: Database,
  input: {
    readonly disabled?: boolean;
    readonly endpointId: string;
    readonly events?: readonly string[];
    readonly tenantId: string;
  },
  now = new Date()
): Promise<EndpointRow | undefined> {
  const changes: Record<string, unknown> = {};

  if (input.events !== undefined) {
    changes.events = [...input.events];
  }

  if (input.disabled !== undefined) {
    changes.disabledAt = input.disabled ? now : null;
  }

  if (Object.keys(changes).length === 0) {
    return await endpointById(db, input);
  }

  const [row] = await db
    .update(webhookEndpoints)
    .set(changes)
    .where(
      and(
        eq(webhookEndpoints.id, input.endpointId),
        eq(webhookEndpoints.tenantId, input.tenantId)
      )
    )
    .returning(ENDPOINT_COLUMNS);

  return row;
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

export async function listDeliveries(
  db: Database,
  tenantId: string,
  options: {
    readonly cursor?: string;
    readonly endpointId?: string;
    readonly limit: number;
    readonly status?: DeliveryStatus;
  }
): Promise<DeliveryPage> {
  const filters = [eq(webhookDeliveries.tenantId, tenantId)];

  if (options.cursor !== undefined) {
    filters.push(lt(webhookDeliveries.id, options.cursor));
  }

  if (options.endpointId !== undefined) {
    filters.push(eq(webhookDeliveries.endpointId, options.endpointId));
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

export interface DeliveryAttemptContext {
  readonly attempts: number;
  readonly disabledAt: Date | null;
  readonly event: string;
  readonly payload: unknown;
  readonly previousSecret: string | null;
  readonly previousSecretExpiresAt: Date | null;
  readonly secret: string;
  readonly status: DeliveryStatus;
  readonly url: string;
}

export async function deliveryForAttempt(
  db: Database,
  input: { readonly deliveryId: string; readonly tenantId: string }
): Promise<DeliveryAttemptContext | undefined> {
  const [row] = await db
    .select({
      attempts: webhookDeliveries.attempts,
      disabledAt: webhookEndpoints.disabledAt,
      event: webhookDeliveries.event,
      payload: webhookDeliveries.payload,
      previousSecret: webhookEndpoints.previousSecret,
      previousSecretExpiresAt: webhookEndpoints.previousSecretExpiresAt,
      secret: webhookEndpoints.secret,
      status: webhookDeliveries.status,
      url: webhookEndpoints.url,
    })
    .from(webhookDeliveries)
    .innerJoin(
      webhookEndpoints,
      eq(webhookDeliveries.endpointId, webhookEndpoints.id)
    )
    .where(
      and(
        eq(webhookDeliveries.id, input.deliveryId),
        eq(webhookDeliveries.tenantId, input.tenantId)
      )
    )
    .limit(1);

  return row;
}

export function secretsFrom(
  row: Pick<
    DeliveryAttemptContext,
    "previousSecret" | "previousSecretExpiresAt" | "secret"
  >,
  now = new Date()
): readonly string[] {
  const previousIsLive =
    row.previousSecret !== null &&
    row.previousSecretExpiresAt !== null &&
    row.previousSecretExpiresAt > now;

  return previousIsLive && row.previousSecret !== null
    ? [row.secret, row.previousSecret]
    : [row.secret];
}
