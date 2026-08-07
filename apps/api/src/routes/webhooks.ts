import type { Database, DeliveryStatus, EndpointRow } from "@propgate/db";
import {
  createEndpoint,
  deleteEndpoint,
  endpointById,
  listDeliveries,
  listEndpoints,
  rotateSecret,
  updateEndpoint,
} from "@propgate/db";
import { generateSecret, WEBHOOK_EVENTS } from "@propgate/webhooks";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../middleware/auth";
import { error, success } from "../utils/response";
import { firstIssue } from "../utils/validation";

/**
 * One endpoint family: `/v1/webhooks`.
 *
 * Deliveries are nested under the endpoint they belong to rather than listed
 * tenant-wide, because a delivery belongs to exactly one endpoint and that is the
 * shape that answers the real question — "did *this* endpoint receive it". It also
 * removes a route-ordering trap: a tenant-wide `/v1/webhooks/deliveries` would
 * collide with `/v1/webhooks/:id` and work or not depending on which was declared
 * first.
 *
 * Rotation is `POST /:id/secret` rather than `/:id/rotate-secret`. It creates a
 * secret, so the noun is the resource and POST is the verb; putting the verb in
 * the path is how one family ends up with three spellings of the same idea.
 */

/**
 * How long the previous secret keeps being accepted after a rotation.
 *
 * Twenty-four hours, which is a deploy window rather than a measurement. It has
 * to be long enough that a customer who rotates and then redeploys on their own
 * schedule is never broken, and short enough that a leaked secret is not accepted
 * for a week. Overridable per request for a customer who wants it shorter, because
 * somebody rotating *because* of a leak wants the window closed sooner.
 */
const DEFAULT_ROTATION_WINDOW_HOURS = 24;
const MAX_ROTATION_WINDOW_HOURS = 168;

const MAX_URL_LENGTH = 2048;
const DEFAULT_DELIVERY_LIMIT = 50;
const MAX_DELIVERY_LIMIT = 200;

const DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  "pending",
  "delivered",
  "failed",
];

/**
 * `https` only, and not a private address.
 *
 * A webhook carries a customer's domain state to a URL they gave us, and we sign
 * it — over plain HTTP that signature protects nothing in transit. Refusing
 * loopback and link-local is the other half: an endpoint pointing at `127.0.0.1`
 * or `169.254.169.254` would make this service a request forwarder into its own
 * network, which is the classic SSRF shape.
 */
const BLOCKED_HOSTS =
  /^(localhost|127\.|0\.0\.0\.0|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;

/**
 * A complaint about a URL, or null to accept it.
 *
 * Injected rather than read from the environment, and the distinction is the
 * whole point: an env flag that relaxes this would exist in the production
 * binary, one `docker run -e` away from being switched on during an incident by
 * someone who needed a webhook to work. A parameter cannot be set by a
 * deployment — the only caller that can pass a different policy is one that
 * constructs the app in-process, which is a test.
 *
 * The reason it needs relaxing at all: an end-to-end spec has to register a
 * receiver it can actually observe, and that receiver is on loopback.
 */
export type WebhookUrlPolicy = (raw: string) => string | null;

export const rejectPublicWebhookUrl: WebhookUrlPolicy = (raw) => {
  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    return `${raw} is not a URL`;
  }

  if (parsed.protocol !== "https:") {
    return "a webhook url must use https, because the signature protects the body and not the connection";
  }

  if (BLOCKED_HOSTS.test(parsed.hostname)) {
    return `${parsed.hostname} is a private or loopback address, which this service will not send to`;
  }

  return null;
};

const eventsSchema = z.array(z.enum(WEBHOOK_EVENTS)).optional();

const createSchema = z.object({
  events: eventsSchema,
  url: z.string().min(1).max(MAX_URL_LENGTH),
});

const updateSchema = z.object({
  disabled: z.boolean().optional(),
  events: eventsSchema,
});

const rotateSchema = z.object({
  windowHours: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_ROTATION_WINDOW_HOURS)
    .optional(),
});

function serialise(endpoint: EndpointRow) {
  return {
    createdAt: endpoint.createdAt.toISOString(),
    disabled: endpoint.disabledAt !== null,
    // Empty means every event, which is what an omitted `events` produces.
    events: endpoint.events,
    id: endpoint.id,
    object: "webhook" as const,
    url: endpoint.url,
  };
}

function boundedLimit(raw: string | undefined): number {
  const requested = Number(raw ?? DEFAULT_DELIVERY_LIMIT);

  return Number.isFinite(requested) && requested > 0
    ? Math.min(requested, MAX_DELIVERY_LIMIT)
    : DEFAULT_DELIVERY_LIMIT;
}

export function createWebhooksRoute(options: {
  db: Database;
  urlPolicy?: WebhookUrlPolicy;
}) {
  const route = new Hono<{ Variables: AuthVariables }>();
  const { db } = options;
  const rejectUrl = options.urlPolicy ?? rejectPublicWebhookUrl;

  route.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return error(c, 422, firstIssue(parsed.error));
    }

    const rejection = rejectUrl(parsed.data.url);

    if (rejection !== null) {
      return error(c, 422, rejection);
    }

    const secret = generateSecret();
    const outcome = await createEndpoint(db, {
      events: parsed.data.events ?? [],
      secret,
      tenantId: c.get("tenantId"),
      url: parsed.data.url,
    });

    return success(
      c,
      {
        ...serialise(outcome.endpoint),
        /**
         * Returned once, and only when this call actually created the endpoint.
         *
         * On an existing endpoint the stored secret is not ours to hand back — we
         * only keep it to sign with, and a retry that returned it would turn an
         * idempotent create into a way to read a secret somebody else set up.
         */
        ...(outcome.kind === "created" ? { secret } : {}),
      },
      { created: outcome.kind === "created" }
    );
  });

  route.get("/", async (c) => {
    const endpoints = await listEndpoints(db, c.get("tenantId"));

    return success(c, endpoints.map(serialise));
  });

  route.get("/:id", async (c) => {
    const endpoint = await endpointById(db, {
      endpointId: c.req.param("id"),
      tenantId: c.get("tenantId"),
    });

    if (endpoint === undefined) {
      return error(c, 404, "no such webhook");
    }

    return success(c, serialise(endpoint));
  });

  route.patch("/:id", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return error(c, 422, firstIssue(parsed.error));
    }

    const updated = await updateEndpoint(db, {
      ...(parsed.data.disabled === undefined
        ? {}
        : { disabled: parsed.data.disabled }),
      endpointId: c.req.param("id"),
      ...(parsed.data.events === undefined
        ? {}
        : { events: parsed.data.events }),
      tenantId: c.get("tenantId"),
    });

    if (updated === undefined) {
      return error(c, 404, "no such webhook");
    }

    return success(c, serialise(updated));
  });

  route.delete("/:id", async (c) => {
    const removed = await deleteEndpoint(db, {
      endpointId: c.req.param("id"),
      tenantId: c.get("tenantId"),
    });

    if (!removed) {
      return error(c, 404, "no such webhook");
    }

    return success(c, { deleted: true, id: c.req.param("id") });
  });

  route.post("/:id/secret", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = rotateSchema.safeParse(body ?? {});

    if (!parsed.success) {
      return error(c, 422, firstIssue(parsed.error));
    }

    const windowHours =
      parsed.data.windowHours ?? DEFAULT_ROTATION_WINDOW_HOURS;
    const secret = generateSecret();
    const expiresAt = new Date(Date.now() + windowHours * 3_600_000);
    const rotated = await rotateSecret(db, {
      endpointId: c.req.param("id"),
      expiresAt,
      secret,
      tenantId: c.get("tenantId"),
    });

    if (!rotated) {
      return error(c, 404, "no such webhook");
    }

    return success(
      c,
      { id: c.req.param("id"), object: "webhook_secret" as const, secret },
      {
        /**
         * When the old secret stops being accepted, so a customer can schedule
         * their redeploy against a date rather than guessing.
         *
         * `windowHours: 0` expires it immediately, which is the right answer when
         * you are rotating because something leaked.
         */
        previousSecretExpiresAt: expiresAt.toISOString(),
      }
    );
  });

  route.get("/:id/deliveries", async (c) => {
    const tenantId = c.get("tenantId");
    const endpointId = c.req.param("id");

    // Checked first so a wrong id is a 404 rather than an empty list, which would
    // otherwise be indistinguishable from an endpoint that has received nothing.
    const endpoint = await endpointById(db, { endpointId, tenantId });

    if (endpoint === undefined) {
      return error(c, 404, "no such webhook");
    }

    const status = c.req.query("status");

    if (
      status !== undefined &&
      !DELIVERY_STATUSES.includes(status as DeliveryStatus)
    ) {
      return error(
        c,
        422,
        `status must be one of ${DELIVERY_STATUSES.join(", ")}, got "${status}"`
      );
    }

    const page = await listDeliveries(db, tenantId, {
      ...(c.req.query("cursor") === undefined
        ? {}
        : { cursor: c.req.query("cursor") as string }),
      endpointId,
      limit: boundedLimit(c.req.query("limit")),
      ...(status === undefined ? {} : { status: status as DeliveryStatus }),
    });

    return success(
      c,
      page.deliveries.map((delivery) => ({
        attempts: delivery.attempts,
        createdAt: delivery.createdAt.toISOString(),
        deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
        domainId: delivery.domainId,
        event: delivery.event,
        id: delivery.id,
        // The reason a dead-lettered delivery is answerable at all. Null while
        // pending and after an eventual success.
        lastError: delivery.lastError,
        object: "webhook_delivery" as const,
        payload: delivery.payload,
        status: delivery.status,
      })),
      { nextCursor: page.nextCursor }
    );
  });

  return route;
}
