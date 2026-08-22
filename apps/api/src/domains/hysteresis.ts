import type { DomainState, StoredVerdict } from "@propgate/db";

export interface HysteresisThresholds {
  readonly degradedAfter: number;
  readonly failedAfter: number;
}

export const DEFAULT_THRESHOLDS: HysteresisThresholds = {
  degradedAfter: 1,
  failedAfter: 3,
};

export interface StateTransition {
  readonly from: DomainState;
  readonly reason: string;
  readonly to: DomainState;
}

export interface HysteresisInput {
  readonly consecutiveFailures: number;
  readonly state: DomainState;
  readonly thresholds?: HysteresisThresholds;
  readonly verdict: StoredVerdict;
}

export interface HysteresisOutcome {
  readonly consecutiveFailures: number;
  readonly state: DomainState;
  readonly transition: StateTransition | null;
}

function transitionTo(
  from: DomainState,
  to: DomainState,
  reason: string
): StateTransition | null {
  return from === to ? null : { from, reason, to };
}

function stateForFailures(
  failures: number,
  current: DomainState,
  thresholds: HysteresisThresholds
): DomainState {
  if (failures >= thresholds.failedAfter) {
    return "failed";
  }

  const couldRegress = current === "verified" || current === "degraded";

  if (couldRegress && failures >= thresholds.degradedAfter) {
    return "degraded";
  }

  return current;
}

export function applyHysteresis(input: HysteresisInput): HysteresisOutcome {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;

  if (input.verdict === "indeterminate") {
    return {
      consecutiveFailures: input.consecutiveFailures,
      state: input.state,
      transition: null,
    };
  }

  if (input.verdict === "fail") {
    const failures = input.consecutiveFailures + 1;
    const state = stateForFailures(failures, input.state, thresholds);

    return {
      consecutiveFailures: failures,
      state,
      transition: transitionTo(
        input.state,
        state,
        `${failures} consecutive ${failures === 1 ? "failure" : "failures"}, reaching the ${state} threshold`
      ),
    };
  }

  const recovered = input.state === "degraded" || input.state === "failed";

  return {
    consecutiveFailures: 0,
    state: "verified",
    transition: transitionTo(
      input.state,
      "verified",
      recovered
        ? `recovered from ${input.state} after a passing check`
        : "every requirement satisfied"
    ),
  };
}
