import type { Database } from "@propgate/db";
import type { ServerAddress } from "@propgate/dns";
import type { ContactList, Mailer } from "@propgate/emails";
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
  TENANT_REQUESTS_PER_SECOND,
  tenantRateLimit,
} from "./middleware/tenant-rate-limit";
import { openApiDocument } from "./openapi";
import { createApiKeysRoute } from "./routes/api-keys";
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
import { createMembersRoute } from "./routes/members";
import { createProfilesRoute } from "./routes/profiles";
import {
  createSignupRoute,
  SIGNUP_RATE_LIMIT_WINDOW_MS,
  SIGNUPS_PER_IP_PER_HOUR,
} from "./routes/signup";
import type { WebhookUrlPolicy } from "./routes/webhooks";
import { createWebhooksRoute } from "./routes/webhooks";
import { RateLimiter } from "./utils/rate-limit";
import { error } from "./utils/response";

export function createApp(options: {
  contacts?: ContactList;
  db?: Database;
  mailer?: Mailer;
  resolver: ServerAddress;
  resolvers?: readonly ServerAddress[];
  thresholds?: HysteresisThresholds;
  webhookUrlPolicy?: WebhookUrlPolicy;
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

    return error(c, 500, "Internal server error");
  });

  app.notFound((c) =>
    error(c, 404, `no route for ${c.req.method} ${c.req.path}`)
  );

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/openapi.json", (c) => {
    c.header("Access-Control-Allow-Origin", "*");
    return c.json(openApiDocument);
  });

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

  const { db } = options;

  if (db !== undefined) {
    const tenantLimiter = new RateLimiter({
      limit: TENANT_REQUESTS_PER_SECOND,
      windowMs: TENANT_RATE_LIMIT_WINDOW_MS,
    });

    if (options.mailer !== undefined) {
      app.route(
        "/v1/signup",
        createSignupRoute({
          ...(options.contacts === undefined
            ? {}
            : { contacts: options.contacts }),
          db,
          limiter: new RateLimiter({
            limit: SIGNUPS_PER_IP_PER_HOUR,
            windowMs: SIGNUP_RATE_LIMIT_WINDOW_MS,
          }),
          mailer: options.mailer,
        })
      );
    }

    for (const path of [
      "/v1/profiles/*",
      "/v1/domains/*",
      "/v1/webhooks/*",
      "/v1/api-keys/*",
      "/v1/members/*",
    ]) {
      app.use(
        path,
        bearerAuth(db),
        tenantRateLimit({ limiter: tenantLimiter })
      );
    }

    app.route("/v1/api-keys", createApiKeysRoute({ db }));
    app.route("/v1/members", createMembersRoute({ db }));
    app.route("/v1/profiles", createProfilesRoute({ db }));
    app.route(
      "/v1/webhooks",
      createWebhooksRoute({
        db,
        ...(options.webhookUrlPolicy === undefined
          ? {}
          : { urlPolicy: options.webhookUrlPolicy }),
      })
    );
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
