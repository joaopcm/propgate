import type { DomainState, StoredVerdict } from "@propgate/db";

/**
 * How many failures it takes to believe one.
 *
 * Invariant 2, and the highest-stakes correctness property in the product. A
 * `domain.failed` webhook fired because one resolver blipped makes our customers
 * page *their* customers for nothing — so the question this answers is not "did a
 * check fail" but "has it failed often enough that something is really wrong".
 *
 * This replaces `nextState` rather than sitting beside it. Two functions that
 * both decide a domain's state is the same "product with two opinions" problem
 * that `checkAndPersist` exists to prevent one layer down.
 */

export interface HysteresisThresholds {
  /**
   * Consecutive failures before a domain is `degraded`.
   *
   * **Unmeasured.** One means the first definite failure is visible immediately,
   * which is the conservative choice for a *warning* — it costs a possibly-noisy
   * event and buys the shortest time to notice. The receipt this waits on is the
   * observed distribution of consecutive transient failures across real monitored
   * domains over thirty days.
   */
  readonly degradedAfter: number;
  /**
   * Consecutive failures before a domain is `failed`.
   *
   * **Unmeasured**, and the number that matters: this is the one that reaches a
   * customer's pager. Three at the `degraded` cadence of five minutes means
   * roughly ten minutes of sustained failure before we say so, which is long
   * enough to outlast a resolver restart or a zone reload and short enough to be
   * useful. Same receipt as above.
   */
  readonly failedAfter: number;
}

export const DEFAULT_THRESHOLDS: HysteresisThresholds = {
  degradedAfter: 1,
  failedAfter: 3,
};

/** Why a domain moved, kept for the audit trail. */
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
  /**
   * Null when the state did not move.
   *
   * This is what makes an event fire once per episode rather than on every
   * check. A domain that stays `degraded` for a week produces one transition,
   * not two thousand — the same rule as invariant 3, which appends to
   * `record_changes` only when a value actually changed. Getting this from "only
   * emit on a real change" rather than from a separate suppression rule is why
   * there is nothing here to forget.
   */
  readonly transition: StateTransition | null;
}

function transitionTo(
  from: DomainState,
  to: DomainState,
  reason: string
): StateTransition | null {
  return from === to ? null : { from, reason, to };
}

/**
 * Where a failing domain lands, given how many times in a row it has failed.
 *
 * The failed threshold is tested first because it is the higher one; checking
 * `degraded` first would mean a domain never got past it when the two are equal.
 */
function stateForFailures(
  failures: number,
  current: DomainState,
  thresholds: HysteresisThresholds
): DomainState {
  if (failures >= thresholds.failedAfter) {
    return "failed";
  }

  if (failures >= thresholds.degradedAfter) {
    return "degraded";
  }

  // Not enough evidence yet. Deliberately keeps the current state rather than
  // inventing an intermediate one: a verified domain that has failed once, with
  // a degraded threshold of two, is still verified as far as anyone asking is
  // concerned.
  return current;
}

export function applyHysteresis(input: HysteresisInput): HysteresisOutcome {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;

  if (input.verdict === "indeterminate") {
    /**
     * Uncertainty is not evidence of failure, and it is not evidence of health
     * either — so nothing moves and the counter is left exactly as it was.
     *
     * Resetting the counter here would be a real bug: a domain that alternates
     * failure and unreachability would never accumulate three consecutive
     * failures and could never reach `failed`, so a genuinely broken domain
     * behind a flaky resolver would be monitored forever and never reported.
     * Incrementing it would be worse — our own resolver having a bad minute
     * would page somebody.
     */
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

  // `pass` or `warn`. A warning is a finding worth showing, not a failure: a
  // domain close to SPF's ten-lookup limit works today, and calling that
  // degraded would train people to ignore the state.
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
