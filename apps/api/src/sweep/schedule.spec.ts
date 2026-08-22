import { describe, expect, it } from "vitest";
import { DEFAULT_INTERVALS, nextCheckAt } from "./schedule";

const NOW = new Date("2026-08-03T12:00:00.000Z");

function minutesAfter(from: Date, at: Date): number {
  return (at.getTime() - from.getTime()) / 60_000;
}

describe("nextCheckAt", () => {
  it("polls a freshly registered domain every 30 seconds", () => {
    const at = nextCheckAt({
      now: NOW,
      state: "pending",
      stateSince: NOW,
    });

    expect(at.getTime() - NOW.getTime()).toBe(DEFAULT_INTERVALS.pendingFastMs);
  });

  it("backs a long-pending domain off to five minutes", () => {
    const registered = new Date(NOW.getTime() - 20 * 60_000);

    const at = nextCheckAt({
      now: NOW,
      state: "pending",
      stateSince: registered,
    });

    expect(minutesAfter(NOW, at)).toBe(5);
  });

  it("keeps the fast cadence right up to the edge of the window", () => {
    const at = nextCheckAt({
      now: NOW,
      state: "pending",
      stateSince: new Date(
        NOW.getTime() - DEFAULT_INTERVALS.pendingFastWindowMs + 1
      ),
    });

    expect(at.getTime() - NOW.getTime()).toBe(DEFAULT_INTERVALS.pendingFastMs);
  });

  it("treats an expired lease as pending rather than as its own cadence", () => {
    const at = nextCheckAt({
      now: NOW,
      state: "verifying",
      stateSince: NOW,
    });

    expect(at.getTime() - NOW.getTime()).toBe(DEFAULT_INTERVALS.pendingFastMs);
  });

  it("checks a verified domain once a day", () => {
    const at = nextCheckAt({
      now: NOW,
      state: "verified",
      stateSince: NOW,
    });

    expect(minutesAfter(NOW, at)).toBe(24 * 60);
  });

  it("watches a degraded domain closely and a failed one hourly", () => {
    const degraded = nextCheckAt({
      now: NOW,
      state: "degraded",
      stateSince: NOW,
    });
    const failed = nextCheckAt({ now: NOW, state: "failed", stateSince: NOW });

    expect(minutesAfter(NOW, degraded)).toBe(5);
    expect(minutesAfter(NOW, failed)).toBe(60);
  });

  it("never polls a verified domain faster than its TTL", () => {
    const at = nextCheckAt({
      minTtlSeconds: 172_800,
      now: NOW,
      state: "verified",
      stateSince: NOW,
    });

    expect(minutesAfter(NOW, at)).toBe(48 * 60);
  });

  it("lets the daily interval win over a short TTL", () => {
    const at = nextCheckAt({
      minTtlSeconds: 300,
      now: NOW,
      state: "verified",
      stateSince: NOW,
    });

    expect(minutesAfter(NOW, at)).toBe(24 * 60);
  });

  it("ignores the TTL floor while a domain is pending", () => {
    const at = nextCheckAt({
      minTtlSeconds: 3600,
      now: NOW,
      state: "pending",
      stateSince: NOW,
    });

    expect(at.getTime() - NOW.getTime()).toBe(DEFAULT_INTERVALS.pendingFastMs);
  });
});
