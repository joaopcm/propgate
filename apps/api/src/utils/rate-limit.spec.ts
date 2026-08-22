import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit";

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

    expect(limiter.take("vetted", 0, 3).allowed).toBe(true);
    expect(limiter.take("vetted", 0, 3).allowed).toBe(true);
    expect(limiter.take("vetted", 0, 3).allowed).toBe(true);
    expect(limiter.take("vetted", 0, 3).allowed).toBe(false);
  });

  it("reports the limit it actually applied", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000 });

    limiter.take("vetted", 0, 5);

    expect(limiter.take("vetted", 0, 5).limit).toBe(5);
  });

  it("forgets callers whose windows have lapsed", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000 });

    limiter.take("a", 0);
    limiter.take("b", 0);

    expect(limiter.size).toBe(2);

    limiter.take("c", 2000);

    expect(limiter.size).toBe(1);
  });
});
