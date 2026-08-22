export interface RateLimitOptions {
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitVerdict {
  readonly allowed: boolean;
  readonly limit: number;
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

  get limit(): number {
    return this.options.limit;
  }

  get windowMs(): number {
    return this.options.windowMs;
  }
}
