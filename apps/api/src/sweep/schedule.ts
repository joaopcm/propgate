import type { DomainState } from "@propgate/db";

/**
 * When to look at a domain again.
 *
 * Adaptive rather than uniform, and `docs/DESIGN.md` calls this out as one of
 * the three product decisions that *are* the infrastructure bill: sweeping
 * everything on one interval costs roughly ten times as much as this and gives a
 * worse experience at both ends — too slow while somebody is waiting at
 * onboarding, too fast for a domain that has been stable for a month.
 *
 * A pure function over an injectable clock, so the whole policy is unit-tested
 * without a sleep anywhere. TESTING.md bans them, and a scheduler is exactly the
 * kind of code that tempts you.
 *
 * **The intervals come from DESIGN.md rather than from a measurement.** That is
 * provenance, not a receipt: they were chosen when the cost model was written
 * and nothing has since observed real domains to confirm them. What would earn
 * the receipt is the observed distribution of time-to-first-success at
 * onboarding (for the pending numbers) and of how often a stable domain's
 * records actually move (for the verified one).
 *
 * They are injectable rather than env-tunable, deliberately. A number nobody has
 * measured does not need a production override yet — it needs the measurement,
 * which Phase 6 takes. The thresholds that *do* get env overrides are the
 * hysteresis ones in Phase 4, where being wrong means a false alarm reaching a
 * customer rather than a slightly wasteful poll.
 */

export interface ScheduleIntervals {
  readonly degradedMs: number;
  readonly failedMs: number;
  readonly pendingFastMs: number;
  /** How long a domain keeps the fast pending cadence before backing off. */
  readonly pendingFastWindowMs: number;
  readonly pendingSlowMs: number;
  readonly verifiedMs: number;
}

export const DEFAULT_INTERVALS: ScheduleIntervals = {
  degradedMs: 300_000,
  failedMs: 3_600_000,
  pendingFastMs: 30_000,
  pendingFastWindowMs: 900_000,
  pendingSlowMs: 300_000,
  verifiedMs: 86_400_000,
};

export interface ScheduleInput {
  readonly intervals?: ScheduleIntervals;
  /**
   * The shortest TTL observed on this check, in seconds, when one was seen.
   *
   * Only ever *raises* the interval, and only for a verified domain. See below.
   */
  readonly minTtlSeconds?: number;
  readonly now: Date;
  readonly state: DomainState;
  /**
   * When the domain entered its current state. For a domain that has never
   * left `pending` this is its registration time, which is what makes the
   * fifteen-minute window measurable without a column to store it in.
   */
  readonly stateSince: Date;
}

function baseIntervalMs(input: ScheduleInput, intervals: ScheduleIntervals) {
  switch (input.state) {
    case "pending":
    // A lease that expired mid-check. Treated as pending because that is what
    // it effectively is: nothing has been established about this domain yet.
    case "verifying": {
      const elapsed = input.now.getTime() - input.stateSince.getTime();

      return elapsed < intervals.pendingFastWindowMs
        ? intervals.pendingFastMs
        : intervals.pendingSlowMs;
    }

    case "verified":
      return intervals.verifiedMs;

    case "degraded":
      return intervals.degradedMs;

    default:
      return intervals.failedMs;
  }
}

export function nextCheckAt(input: ScheduleInput): Date {
  const intervals = input.intervals ?? DEFAULT_INTERVALS;
  const base = baseIntervalMs(input, intervals);

  /**
   * The TTL floor applies to `verified` and nothing else.
   *
   * For a domain that already passes, the only question left is whether anything
   * changed, and nothing can change faster than the TTL — so polling inside it
   * spends queries to re-read a cache. Raising the interval to the TTL is free
   * accuracy.
   *
   * Applying it while `pending` would be actively wrong. There the customer has
   * just edited their zone and we are waiting to notice; a provider serving a
   * one-hour negative TTL would push the first re-check an hour out and make
   * onboarding feel broken. Our own resolver's cache may still delay us by up to
   * the TTL, which is acceptable because it self-corrects, unlike a scheduling
   * decision that is wrong until the state changes.
   */
  const floorMs =
    input.state === "verified" && input.minTtlSeconds !== undefined
      ? input.minTtlSeconds * 1000
      : 0;

  return new Date(input.now.getTime() + Math.max(base, floorMs));
}
