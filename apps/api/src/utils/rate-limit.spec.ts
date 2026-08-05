import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit";

/**
 * The token bucket behind every limit in the API.
 *
 * The clock is injected, so none of this sleeps — a limiter spec that waits for
 * real windows to lapse is a slow suite that still cannot test a one-hour window.
 */

describe("RateLimiter", () => {
  it("allows up to the limit and refuses past it", () => {
    const limiter = new RateLimiter({ limit: 2, windowMs: 1000 });

    expect(limiter.take("a", 0).allowed).toBe(true);
    expect(limiter.take("a", 0).allowed).toBe(true);
    expect(limiter.take("a", 0).allowed).toBe(false);
  });

  it("counts each caller separately", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000 });

    limiter.take("a", 0);

    expect(limiter.take("b", 0).allowed).toBe(true);
  });

  it("starts a fresh window once the old one lapses", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000 });

    limiter.take("a", 0);

    expect(limiter.take("a", 999).allowed).toBe(false);
    expect(limiter.take("a", 1000).allowed).toBe(true);
  });

  it("reports the wait, for Retry-After", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });

    limiter.take("a", 0);

    expect(limiter.take("a", 30_000).retryAfterSeconds).toBe(30);
  });

  it("applies a per-call limit over the configured one", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000 });

    // What a raised `tenants.request_quota_per_second` buys: the same limiter and
    // the same window, a different ceiling for one caller.
    expect(limiter.take("vetted", 0, 3).allowed).toBe(true);
    expect(limiter.take("vetted", 0, 3).allowed).toBe(true);
    expect(limiter.take("vetted", 0, 3).allowed).toBe(true);
    expect(limiter.take("vetted", 0, 3).allowed).toBe(false);
  });

  it("reports the limit it actually applied", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000 });

    limiter.take("vetted", 0, 5);

    // The 429 message reads this. Reporting the constant instead would send a
    // partner on an override hunting for a limit they never hit.
    expect(limiter.take("vetted", 0, 5).limit).toBe(5);
  });

  it("forgets callers whose windows have lapsed", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000 });

    limiter.take("a", 0);
    limiter.take("b", 0);

    expect(limiter.size).toBe(2);

    // Otherwise this map is a slow leak keyed by client address, which on a
    // long-running process surfaces as an OOM weeks after deploy.
    limiter.take("c", 2000);

    expect(limiter.size).toBe(1);
  });
});
