import type { ServerAddress } from "@propgate/dns";
import { captureException } from "@sentry/node";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { env } from "./env";
import {
  CHECKS_PER_MINUTE,
  createChecksRoute,
  RATE_LIMIT_WINDOW_MS,
} from "./routes/checks";
import { RateLimiter } from "./utils/rate-limit";

/**
 * A factory rather than a module-level instance, so tests can point the app at
 * the fixture tier without going through the environment. Reading the resolver
 * from `env` at import time would mean every spec that wants a different one
 * has to mutate `process.env` before the first import — the kind of ordering
 * dependency that works until someone reorders the imports.
 */
export function createApp(options: { resolver: ServerAddress }) {
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

  return app;
}

export default createApp({
  resolver: { address: env.RESOLVER_ADDRESS, port: env.RESOLVER_PORT },
});
