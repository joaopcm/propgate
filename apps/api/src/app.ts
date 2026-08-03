import type { Database } from "@propgate/db";
import type { ServerAddress } from "@propgate/dns";
import type { DeliverWebhookPayload } from "@propgate/jobs";
import { captureException } from "@sentry/node";
import type { Queue } from "bullmq";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { HysteresisThresholds } from "./domains/hysteresis";
import { bearerAuth } from "./middleware/auth";
import {
  TENANT_RATE_LIMIT_WINDOW_MS,
  TENANT_REQUESTS_PER_MINUTE,
  tenantRateLimit,
} from "./middleware/tenant-rate-limit";
import {
  CHECKS_PER_MINUTE,
  createChecksRoute,
  RATE_LIMIT_WINDOW_MS,
} from "./routes/checks";
import {
  CHECK_RATE_LIMIT_WINDOW_MS,
  CHECKS_PER_TENANT_PER_MINUTE,
  createDomainsRoute,
} from "./routes/domains";
import { createProfilesRoute } from "./routes/profiles";
import { RateLimiter } from "./utils/rate-limit";

/**
 * A factory rather than a module-level instance, so tests can point the app at
 * the fixture tier without going through the environment. Reading the resolver
 * from `env` at import time would mean every spec that wants a different one
 * has to mutate `process.env` before the first import — the kind of ordering
 * dependency that works until someone reorders the imports.
 *
 * `db` is optional for the same reason it is not simply read from `env`: the
 * public checker is the whole product without a database, and the specs that
 * cover it should not need one running. When it is absent the authenticated
 * routes are not mounted at all, rather than mounted and failing on the first
 * query.
 */
export function createApp(options: {
  db?: Database;
  /** The single resolver behind the public checker. */
  resolver: ServerAddress;
  /**
   * The vantage-point pool for authenticated checks. Defaults to the single
   * resolver above, so a deployment that has not configured a pool behaves
   * exactly as it did before rather than failing.
   */
  resolvers?: readonly ServerAddress[];
  /** Hysteresis thresholds. Defaults are in `hysteresis.ts`. */
  thresholds?: HysteresisThresholds;
  /** Absent means deliveries are recorded but wait for the reconciler. */
  webhooks?: Queue<DeliverWebhookPayload>;
}) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return err.getResponse();
    }

    captureException(err, {
      extra: { method: c.req.method, path: c.req.path },
    });

    return c.json(
      { data: null, error: { message: "Internal server error" }, meta: null },
      500
    );
  });

  app.get("/health", (c) => c.json({ status: "ok" }));

  /**
   * CORS, on the public checker and nowhere else.
   *
   * The checker is a browser calling a different origin, so without this it
   * cannot work at all. The authenticated routes deliberately get nothing: a
   * bearer token belongs in a server-to-server call, and a browser able to
   * reach `/v1/domains` is a browser holding a key that should never have left
   * a backend. Sending permissive CORS there would invite exactly that.
   */
  app.use(
    "/v1/checks",
    cors({ allowMethods: ["POST", "OPTIONS"], origin: "*" })
  );

  app.route(
    "/v1/checks",
    createChecksRoute({
      limiter: new RateLimiter({
        limit: CHECKS_PER_MINUTE,
        windowMs: RATE_LIMIT_WINDOW_MS,
      }),
      resolver: options.resolver,
    })
  );

  // GET /v1/dns/lookup — the raw per-vantage-point escape hatch — lands here
  // once there is more than one vantage point to ask.

  const { db } = options;

  if (db !== undefined) {
    const tenantLimiter = new RateLimiter({
      limit: TENANT_REQUESTS_PER_MINUTE,
      windowMs: TENANT_RATE_LIMIT_WINDOW_MS,
    });

    // The wildcard covers the bare prefix too — `/v1/domains/*` matches
    // `/v1/domains`, which is worth knowing because registering both spellings
    // is not harmless: each one that matches runs `bearerAuth` again, and that
    // is a second key lookup and a second `last_used_at` write per request.
    // `domains.db.spec.ts` pins the collection endpoints at 401 regardless.
    for (const path of ["/v1/profiles/*", "/v1/domains/*"]) {
      // Authentication first, then the limiter — it is keyed on the tenant the
      // first one resolved, which is the whole reason it is not spoofable.
      app.use(
        path,
        bearerAuth(db),
        tenantRateLimit({ limiter: tenantLimiter })
      );
    }

    app.route("/v1/profiles", createProfilesRoute({ db }));
    app.route(
      "/v1/domains",
      createDomainsRoute({
        checkLimiter: new RateLimiter({
          limit: CHECKS_PER_TENANT_PER_MINUTE,
          windowMs: CHECK_RATE_LIMIT_WINDOW_MS,
        }),
        db,
        resolver: options.resolver,
        resolvers: options.resolvers ?? [options.resolver],
        ...(options.thresholds === undefined
          ? {}
          : { thresholds: options.thresholds }),
        ...(options.webhooks === undefined
          ? {}
          : { webhooks: options.webhooks }),
      })
    );
  }

  return app;
}
