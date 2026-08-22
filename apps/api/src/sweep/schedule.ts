import type { DomainState } from "@propgate/db";

export interface ScheduleIntervals {
  readonly degradedMs: number;
  readonly failedMs: number;
  readonly pendingFastMs: number;
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
  readonly minTtlSeconds?: number;
  readonly now: Date;
  readonly state: DomainState;
  readonly stateSince: Date;
}

function baseIntervalMs(input: ScheduleInput, intervals: ScheduleIntervals) {
  switch (input.state) {
    case "pending":
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

  const floorMs =
    input.state === "verified" && input.minTtlSeconds !== undefined
      ? input.minTtlSeconds * 1000
      : 0;

  return new Date(input.now.getTime() + Math.max(base, floorMs));
}
