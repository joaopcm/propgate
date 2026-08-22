import type { DomainState, StoredVerdict } from "@propgate/db";
import { describe, expect, it } from "vitest";
import { applyHysteresis, DEFAULT_THRESHOLDS } from "./hysteresis";

function step(
  state: DomainState,
  verdict: StoredVerdict,
  consecutiveFailures = 0
) {
  return applyHysteresis({ consecutiveFailures, state, verdict });
}

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
    const outcome = step("pending", "fail");

    expect(outcome.state).toBe("pending");
    expect(outcome.transition).toBeNull();
    expect(outcome.consecutiveFailures).toBe(1);
  });

  it("takes a never-verified domain straight to failed at the threshold", () => {
    const outcome = sequence(["fail", "fail", "fail"], "pending");

    expect(outcome.state).toBe("failed");
    expect(outcome.transitions).toEqual(["pending->failed"]);
  });

  it("reaches failed only at the threshold", () => {
    const two = sequence(["fail", "fail"]);
    const three = sequence(["fail", "fail", "fail"]);

    expect(two.state).toBe("degraded");
    expect(three.state).toBe("failed");
    expect(DEFAULT_THRESHOLDS.failedAfter).toBe(3);
  });

  it("never reaches failed when failures alternate with passes", () => {
    const outcome = sequence(["fail", "pass", "fail", "pass", "fail", "pass"]);

    expect(outcome.state).toBe("verified");
    expect(outcome.consecutiveFailures).toBe(0);
  });

  it("counts a run of failures rather than a total", () => {
    const outcome = sequence(["fail", "fail", "pass", "fail", "fail"]);

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
    const outcome = applyHysteresis({
      consecutiveFailures: 0,
      state: "verified",
      thresholds: { degradedAfter: 1, failedAfter: 1 },
      verdict: "fail",
    });

    expect(outcome.state).toBe("failed");
  });
});
