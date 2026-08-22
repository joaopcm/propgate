import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { RateLimiter } from "../utils/rate-limit";
import type { AuthVariables } from "./auth";
import { tenantRateLimit } from "./tenant-rate-limit";

function appLimitedTo(limit: number, override: number | null = null) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const limiter = new RateLimiter({ limit, windowMs: 60_000 });

  app.use("/protected/:tenant", async (c, next) => {
    c.set("tenantId", c.req.param("tenant"));
    c.set("requestQuotaPerSecond", override);
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
    expect((await response.json()).error.message).toBe(
      "rate limit of 2 requests per 60s exceeded; try again in 60s"
    );
  });

  it("lets a raised quota through past the default", async () => {
    const app = appLimitedTo(2, 4);

    await app.request("/protected/a");
    await app.request("/protected/a");

    expect((await app.request("/protected/a")).status).toBe(200);
    expect((await app.request("/protected/a")).status).toBe(200);
    expect((await app.request("/protected/a")).status).toBe(429);
  });

  it("names the raised quota in the refusal, not the default", async () => {
    const app = appLimitedTo(2, 4);

    await Promise.all(
      Array.from({ length: 4 }, () => app.request("/protected/a"))
    );

    const response = await app.request("/protected/a");

    expect((await response.json()).error.message).toContain(
      "rate limit of 4 requests"
    );
  });

  it("counts each tenant separately", async () => {
    const app = appLimitedTo(2);

    await app.request("/protected/a");
    await app.request("/protected/a");
    await app.request("/protected/a");

    expect((await app.request("/protected/b")).status).toBe(200);
  });
});
