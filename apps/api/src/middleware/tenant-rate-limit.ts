import { createMiddleware } from "hono/factory";
import type { RateLimiter } from "../utils/rate-limit";
import { error } from "../utils/response";
import type { AuthVariables } from "./auth";

/**
 * Per-tenant rate limiting, for authenticated routes.
 *
 * Unlike the public checker's limiter this one is keyed on something a caller
 * cannot forge: the tenant resolved from an API key, not an
 * `X-Forwarded-For` header. It must therefore run *after* `bearerAuth`, which
 * is why it reads the tenant from the context rather than taking it as an
 * argument.
 */

/**
 * The receipt, measured against the schema this limits, on one connection:
 *
 *  - authenticating a request costs **0.288 ms** (3,470/s)
 *  - registering a domain costs **0.783 ms** (1,277/s)
 *
 * So 250 registrations a second from one tenant is ~196 ms of a single Postgres
 * connection — about 20% — and a fifty-thousand-domain import finishes in three
 * and a half minutes. That is past where any real integration goes while leaving
 * plenty of headroom for the other tenants sharing the pool.
 *
 * **The window is one second, not a minute, and that matters more than the
 * number.** The same average over sixty seconds permits the entire allowance as
 * one instantaneous burst, which is precisely the shape that hurts a connection
 * pool. This came down from 30,000/minute when signup opened: that number was
 * chosen when a tenant meant a partner we had spoken to, and it stopped being
 * true the moment anybody with an email address could mint a key.
 *
 * `tenants.request_quota_per_second` raises it for a tenant we have vetted.
 *
 * Routes whose work is not a database write set their own, tighter number:
 * `POST /v1/checks` is limited separately because a check costs ten upstream
 * DNS queries rather than a millisecond of Postgres.
 */
export const TENANT_REQUESTS_PER_SECOND = 250;
export const TENANT_RATE_LIMIT_WINDOW_MS = 1000;

export function tenantRateLimit(options: { limiter: RateLimiter }) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    // Null means "no override", which is what the limiter's own default is for.
    const override = c.get("requestQuotaPerSecond") ?? undefined;
    const verdict = options.limiter.take(
      c.get("tenantId"),
      Date.now(),
      override
    );

    if (!verdict.allowed) {
      c.header("Retry-After", String(verdict.retryAfterSeconds));

      // Name the limit and the wait, read off the verdict that enforced them
      // rather than off a constant this instance may not have been built with —
      // and which, with per-tenant overrides, may not even be this tenant's.
      // An agent can act on this; "429" alone sends it into a retry loop
      // against the thing already saying no.
      return error(
        c,
        429,
        `rate limit of ${verdict.limit} requests per ${Math.round(options.limiter.windowMs / 1000)}s exceeded; try again in ${verdict.retryAfterSeconds}s`
      );
    }

    await next();
  });
}
