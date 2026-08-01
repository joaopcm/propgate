import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { RateLimiter } from "../utils/rate-limit";
import type { AuthVariables } from "./auth";
import { tenantRateLimit } from "./tenant-rate-limit";

/** Two requests per window, so the limit is reachable without a loop. */
function appLimitedTo(limit: number) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const limiter = new RateLimiter({ limit, windowMs: 60_000 });

  app.use("/protected/:tenant", async (c, next) => {
    c.set("tenantId", c.req.param("tenant"));
    await next();
  });
  app.use("/protected/:tenant", tenantRateLimit({ limiter }));
  app.get("/protected/:tenant", (c) => c.json({ ok: true }));

  return app;
}

describe("tenantRateLimit", () => {
  it("lets a tenant through up to the limit", async () => {
    const app = appLimitedTo(2);

    expect((await app.request("/protected/a")).status).toBe(200);
    expect((await app.request("/protected/a")).status).toBe(200);
  });

  it("refuses past it, and says how long to wait", async () => {
    const app = appLimitedTo(2);

    await app.request("/protected/a");
    await app.request("/protected/a");
    const response = await app.request("/protected/a");

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    // The numbers come from the limiter that enforced them, not from the
    // production constant — otherwise the message is a confident lie.
    expect((await response.json()).error.message).toBe(
      "rate limit of 2 requests per 60s exceeded; try again in 60s"
    );
  });

  it("counts each tenant separately", async () => {
    // Keyed on the authenticated tenant, so one partner's import cannot spend
    // another partner's budget.
    const app = appLimitedTo(2);

    await app.request("/protected/a");
    await app.request("/protected/a");
    await app.request("/protected/a");

    expect((await app.request("/protected/b")).status).toBe(200);
  });
});
