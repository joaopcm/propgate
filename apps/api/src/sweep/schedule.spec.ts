import { describe, expect, it } from "vitest";
import { DEFAULT_INTERVALS, nextCheckAt } from "./schedule";

/**
 * The whole scheduling policy, without a sleep.
 *
 * Every interval that matters to the bill is decided here, so this is where a
 * change to the cost model shows up as a failing assertion rather than as a
 * surprise on an invoice.
 */

const NOW = new Date("2026-08-03T12:00:00.000Z");

function minutesAfter(from: Date, at: Date): number {
  return (at.getTime() - from.getTime()) / 60_000;
}

describe("nextCheckAt", () => {
  it("polls a freshly registered domain every 30 seconds", () => {
    // Somebody is watching this one. It was registered a moment ago and the
    // records may land at any second.
    const at = nextCheckAt({
      now: NOW,
      state: "pending",
      stateSince: NOW,
    });

    expect(at.getTime() - NOW.getTime()).toBe(DEFAULT_INTERVALS.pendingFastMs);
  });

  it("backs a long-pending domain off to five minutes", () => {
    // Past the fast window nobody is still staring at the screen, and the fast
    // cadence is just cost.
    const registered = new Date(NOW.getTime() - 20 * 60_000);

    const at = nextCheckAt({
      now: NOW,
      state: "pending",
      stateSince: registered,
    });

    expect(minutesAfter(NOW, at)).toBe(5);
  });

  it("keeps the fast cadence right up to the edge of the window", () => {
    // A boundary rather than a round number, because an off-by-one here is
    // invisible in production: it just costs slightly more or slightly less.
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
    // `verifying` means a check claimed this row and did not finish. Nothing has
    // been established, so it belongs on the pending cadence.
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
    // Degraded is the state where the next check decides whether this becomes a
    // customer-visible failure, so it is the one worth paying for.
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
    // A two-day TTL means nothing can change for two days. Asking daily spends
    // queries to re-read a cache.
    const at = nextCheckAt({
      minTtlSeconds: 172_800,
      now: NOW,
      state: "verified",
      stateSince: NOW,
    });

    expect(minutesAfter(NOW, at)).toBe(48 * 60);
  });

  it("lets the daily interval win over a short TTL", () => {
    // The floor only ever raises. A 300-second TTL does not mean we check a
    // stable domain every five minutes.
    const at = nextCheckAt({
      minTtlSeconds: 300,
      now: NOW,
      state: "verified",
      stateSince: NOW,
    });

    expect(minutesAfter(NOW, at)).toBe(24 * 60);
  });

  it("ignores the TTL floor while a domain is pending", () => {
    // The case this exists for. A provider serving a one-hour negative TTL would
    // otherwise push the first re-check an hour out, and onboarding would look
    // broken to somebody who just pasted their records in correctly.
    const at = nextCheckAt({
      minTtlSeconds: 3600,
      now: NOW,
      state: "pending",
      stateSince: NOW,
    });

    expect(at.getTime() - NOW.getTime()).toBe(DEFAULT_INTERVALS.pendingFastMs);
  });
});
