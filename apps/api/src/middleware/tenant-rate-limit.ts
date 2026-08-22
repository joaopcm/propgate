import { createMiddleware } from "hono/factory";
import type { RateLimiter } from "../utils/rate-limit";
import { error } from "../utils/response";
import type { AuthVariables } from "./auth";

export const TENANT_REQUESTS_PER_SECOND = 250;
export const TENANT_RATE_LIMIT_WINDOW_MS = 1000;

export function tenantRateLimit(options: { limiter: RateLimiter }) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const override = c.get("requestQuotaPerSecond") ?? undefined;
    const verdict = options.limiter.take(
      c.get("tenantId"),
      Date.now(),
      override
    );

    if (!verdict.allowed) {
      c.header("Retry-After", String(verdict.retryAfterSeconds));

      return error(
        c,
        429,
        `rate limit of ${verdict.limit} requests per ${Math.round(options.limiter.windowMs / 1000)}s exceeded; try again in ${verdict.retryAfterSeconds}s`
      );
    }

    await next();
  });
}
