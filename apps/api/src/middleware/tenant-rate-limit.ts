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
 * So 500 requests a second from one tenant is around 40% of a single Postgres
 * connection, and a fifty-thousand-domain import finishes in under two minutes.
 * That puts the limit past where any real integration goes and leaves only
 * runaway loops touching it — a tripwire, not a quota.
 *
 * Routes whose work is not a database write set their own, tighter number:
 * `POST /v1/checks` is limited separately because a check costs ten upstream
 * DNS queries rather than a millisecond of Postgres.
 */
export const TENANT_REQUESTS_PER_MINUTE = 30_000;
export const TENANT_RATE_LIMIT_WINDOW_MS = 60_000;

export function tenantRateLimit(options: { limiter: RateLimiter }) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const verdict = options.limiter.take(c.get("tenantId"));

    if (!verdict.allowed) {
      c.header("Retry-After", String(verdict.retryAfterSeconds));

      // Name the limit and the wait, read off the limiter that enforced them
      // rather than off a constant this instance may not have been built with.
      // An agent can act on this; "429" alone sends it into a retry loop
      // against the thing already saying no.
      return error(
        c,
        429,
        `rate limit of ${options.limiter.limit} requests per ${Math.round(options.limiter.windowMs / 1000)}s exceeded; try again in ${verdict.retryAfterSeconds}s`
      );
    }

    await next();
  });
}
