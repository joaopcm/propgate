/**
 * A per-client token bucket, in memory.
 *
 * In memory is not a compromise here, it is the right answer: the API is one
 * long-running process by design (no serverless anywhere near the resolver), so
 * there is exactly one place for the counter to live and no reason to pay
 * Redis for it. If this ever runs behind more than one instance, the limit
 * becomes per-instance — which is a real change and should be a deliberate one,
 * not something discovered.
 *
 * This is a tripwire, not a security boundary. The client address comes from a
 * header, so it is spoofable without a trusted proxy in front. It exists so a
 * script cannot turn the public checker into a DNS amplifier by accident, and a
 * good widget never feels it.
 */

export interface RateLimitOptions {
  /** Requests allowed per window. */
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitVerdict {
  readonly allowed: boolean;
  /**
   * The limit that was applied to *this* call.
   *
   * Reported rather than read back off the limiter because a caller may have an
   * override, and a 429 naming the shared default when a different number was
   * enforced sends an integrator hunting for a limit they never hit.
   */
  readonly limit: number;
  /** Seconds until the window resets, for Retry-After. */
  readonly retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly options: RateLimitOptions;
  private readonly windows = new Map<string, Window>();

  constructor(options: RateLimitOptions) {
    this.options = options;
  }

  /**
   * `limit` overrides the configured one for this call only.
   *
   * The window is shared and the ceiling is per-caller, which is what lets one
   * limiter serve tenants on different quotas without a limiter instance per
   * tenant — the counting is identical, only the comparison differs.
   */
  take(
    key: string,
    now = Date.now(),
    limit = this.options.limit
  ): RateLimitVerdict {
    this.evictExpired(now);

    const existing = this.windows.get(key);

    if (existing === undefined || existing.resetAt <= now) {
      this.windows.set(key, {
        count: 1,
        resetAt: now + this.options.windowMs,
      });

      return { allowed: true, limit, retryAfterSeconds: 0 };
    }

    existing.count += 1;

    if (existing.count <= limit) {
      return { allowed: true, limit, retryAfterSeconds: 0 };
    }

    return {
      allowed: false,
      limit,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000)
      ),
    };
  }

  /**
   * Drop windows that have lapsed.
   *
   * Without this the map is a slow memory leak keyed by client address, which
   * on a long-running process is the kind of thing that shows up as an OOM
   * three weeks after deploy with nothing in the logs.
   */
  private evictExpired(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) {
        this.windows.delete(key);
      }
    }
  }

  get size(): number {
    return this.windows.size;
  }

  /**
   * The configured numbers, so a 429 can name the limit it enforced rather than
   * a constant that may not be the one this instance was built with.
   */
  get limit(): number {
    return this.options.limit;
  }

  get windowMs(): number {
    return this.options.windowMs;
  }
}
