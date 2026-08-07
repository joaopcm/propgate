import type { DomainState, StoredVerdict } from "@propgate/db";
import { describe, expect, it } from "vitest";
import { applyHysteresis, DEFAULT_THRESHOLDS } from "./hysteresis";

/**
 * The state machine, exhaustively.
 *
 * Invariant 2 lives here. Every assertion in this file is a promise that a
 * customer's customer does not get paged for nothing, so the interesting cases
 * are the ones where a naive implementation would look correct.
 */

function step(
  state: DomainState,
  verdict: StoredVerdict,
  consecutiveFailures = 0
) {
  return applyHysteresis({ consecutiveFailures, state, verdict });
}

/** Feed a sequence of verdicts through, starting from `verified` by default. */
function sequence(
  verdicts: readonly StoredVerdict[],
  from: DomainState = "verified"
) {
  let state: DomainState = from;
  let consecutiveFailures = 0;
  const transitions: string[] = [];

  for (const verdict of verdicts) {
    const outcome = applyHysteresis({ consecutiveFailures, state, verdict });

    ({ consecutiveFailures, state } = outcome);

    if (outcome.transition !== null) {
      transitions.push(`${outcome.transition.from}->${outcome.transition.to}`);
    }
  }

  return { consecutiveFailures, state, transitions };
}

describe("applyHysteresis", () => {
  it("moves a verified domain to degraded on the first definite failure", () => {
    const outcome = step("verified", "fail");

    expect(outcome.state).toBe("degraded");
    expect(outcome.consecutiveFailures).toBe(1);
    expect(outcome.transition).toMatchObject({
      from: "verified",
      to: "degraded",
    });
  });

  it("does not degrade a domain that was never verified", () => {
    /**
     * `degraded` is a regression, so it needs something to have regressed from.
     *
     * Two things reach this: a freshly registered domain whose customer has not
     * added the records yet, and a domain reset to `pending` because its
     * expectations were rotated. `domain.degraded` on either is a webhook saying
     * "this used to work" about something that never did.
     */
    const outcome = step("pending", "fail");

    expect(outcome.state).toBe("pending");
    expect(outcome.transition).toBeNull();
    // The failure is still counted. It just has nowhere worse to go yet.
    expect(outcome.consecutiveFailures).toBe(1);
  });

  it("takes a never-verified domain straight to failed at the threshold", () => {
    // Skipping `degraded` is not skipping the hysteresis: it still takes three
    // consecutive failures, and `failed` is the honest word for a domain whose
    // records were never published.
    const outcome = sequence(["fail", "fail", "fail"], "pending");

    expect(outcome.state).toBe("failed");
    expect(outcome.transitions).toEqual(["pending->failed"]);
  });

  it("reaches failed only at the threshold", () => {
    // Two failures is not enough. This is the entire point of the mechanism.
    const two = sequence(["fail", "fail"]);
    const three = sequence(["fail", "fail", "fail"]);

    expect(two.state).toBe("degraded");
    expect(three.state).toBe("failed");
    expect(DEFAULT_THRESHOLDS.failedAfter).toBe(3);
  });

  it("never reaches failed when failures alternate with passes", () => {
    // The case the whole invariant exists for. A domain that fails, recovers,
    // fails, recovers is a flapping resolver or a zone being edited — not an
    // outage, and nobody should be paged for it.
    const outcome = sequence(["fail", "pass", "fail", "pass", "fail", "pass"]);

    expect(outcome.state).toBe("verified");
    expect(outcome.consecutiveFailures).toBe(0);
  });

  it("counts a run of failures rather than a total", () => {
    const outcome = sequence(["fail", "fail", "pass", "fail", "fail"]);

    // Four failures overall, but the longest run since the last pass is two.
    expect(outcome.state).toBe("degraded");
    expect(outcome.consecutiveFailures).toBe(2);
  });

  it("leaves everything untouched on an indeterminate check", () => {
    const outcome = step("verified", "indeterminate", 2);

    expect(outcome.state).toBe("verified");
    expect(outcome.consecutiveFailures).toBe(2);
    expect(outcome.transition).toBeNull();
  });

  it("does not let indeterminate checks reset the failure run", () => {
    // The subtle bug this guards. If uncertainty reset the counter, a genuinely
    // broken domain behind a flaky resolver could never accumulate three
    // consecutive failures — so it would be monitored forever and never
    // reported, which is the failure mode that looks like everything is fine.
    const outcome = sequence([
      "fail",
      "indeterminate",
      "fail",
      "indeterminate",
      "fail",
    ]);

    expect(outcome.consecutiveFailures).toBe(3);
    expect(outcome.state).toBe("failed");
  });

  it("does not let indeterminate checks accumulate towards failure either", () => {
    // The mirror image, and the more dangerous direction: our own resolver
    // having a bad five minutes must not page anyone.
    const outcome = sequence([
      "indeterminate",
      "indeterminate",
      "indeterminate",
      "indeterminate",
    ]);

    expect(outcome.state).toBe("verified");
    expect(outcome.consecutiveFailures).toBe(0);
    expect(outcome.transitions).toEqual([]);
  });

  it("reports a transition once per episode, not once per check", () => {
    // What keeps `degraded` from becoming a channel people mute. A domain that
    // stays degraded produces one transition however long it stays there.
    const outcome = sequence(["fail", "fail"]);

    expect(outcome.transitions).toEqual(["verified->degraded"]);
  });

  it("stays silent while a failed domain keeps failing", () => {
    const outcome = sequence(["fail", "fail", "fail", "fail", "fail", "fail"]);

    expect(outcome.state).toBe("failed");
    expect(outcome.transitions).toEqual([
      "verified->degraded",
      "degraded->failed",
    ]);
  });

  it("recovers from failed straight to verified", () => {
    // No walk back down through degraded. One passing check is enough evidence
    // that the records are right, and a recovery that took three checks to be
    // believed would leave a customer staring at a red dashboard after they had
    // already fixed it.
    const outcome = step("failed", "pass", 5);

    expect(outcome.state).toBe("verified");
    expect(outcome.consecutiveFailures).toBe(0);
    expect(outcome.transition).toMatchObject({
      from: "failed",
      to: "verified",
    });
    expect(outcome.transition?.reason).toContain("recovered");
  });

  it("treats a warning as healthy", () => {
    // A domain near SPF's ten-lookup limit works today. Calling it degraded
    // would put most of the internet in a warning state.
    const outcome = step("verified", "warn");

    expect(outcome.state).toBe("verified");
    expect(outcome.transition).toBeNull();
  });

  it("takes a pending domain to verified on its first pass", () => {
    const outcome = step("pending", "pass");

    expect(outcome.state).toBe("verified");
    expect(outcome.transition).toMatchObject({
      from: "pending",
      to: "verified",
    });
  });

  it("keeps a domain where it is when the threshold is not yet met", () => {
    // With a degraded threshold of two, one failure is not yet worth saying
    // anything about.
    const outcome = applyHysteresis({
      consecutiveFailures: 0,
      state: "verified",
      thresholds: { degradedAfter: 2, failedAfter: 4 },
      verdict: "fail",
    });

    expect(outcome.state).toBe("verified");
    expect(outcome.consecutiveFailures).toBe(1);
    expect(outcome.transition).toBeNull();
  });

  it("goes straight to failed when both thresholds are one", () => {
    // An operator who wants no hysteresis at all should get none, rather than a
    // domain that sticks at degraded because the checks are ordered wrongly.
    const outcome = applyHysteresis({
      consecutiveFailures: 0,
      state: "verified",
      thresholds: { degradedAfter: 1, failedAfter: 1 },
      verdict: "fail",
    });

    expect(outcome.state).toBe("failed");
  });
});
