import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import type { ServerAddress } from "../types";
import { createEvaluationContext } from "./context";
import { evaluateSpf } from "./spf";

/**
 * The whole-evaluation deadline, which RFC 7208 §4.6.4 asks for alongside the
 * lookup count: "SPF implementations SHOULD limit the total amount of data
 * obtained" and the total time spent obtaining it.
 *
 * Ten lookups against a slow authority is ten timeouts, and a check nobody will
 * run interactively. The budget is what makes the worst case bounded in seconds
 * rather than in round trips.
 */

const fixture = fixtureTarget("auth");
const TARGET: ServerAddress = {
  address: fixture.address,
  port: fixture.port,
};

describe("the evaluation deadline", () => {
  it("stops spending lookups once the budget is gone", async () => {
    // near.spf.test costs eight lookups. With no time left, the first is the
    // only one attempted and the rest are recorded as skipped rather than
    // silently dropped — the derivation has to show what did not happen too.
    const context = createEvaluationContext({
      budgetMs: 0,
      target: TARGET,
      timeoutMs: 2000,
    });

    const result = await evaluateSpf(context, { domain: "near.spf.test" });

    expect(result.lookups.length).toBeGreaterThan(0);
    expect(
      result.lookups.every((lookup) =>
        lookup.purpose.includes("budget exhausted")
      )
    ).toBe(true);
  });

  it("is indeterminate, never a verdict about the domain", async () => {
    // We ran out of time; the domain did not do anything wrong. Reporting a
    // failure here would page someone because our own deadline was too tight.
    const context = createEvaluationContext({
      budgetMs: 0,
      target: TARGET,
      timeoutMs: 2000,
    });

    const result = await evaluateSpf(context, { domain: "spf.test" });

    expect(result.verdict).toBe("indeterminate");
  });

  it("completes the same check when there is time", async () => {
    const context = createEvaluationContext({
      budgetMs: 15_000,
      target: TARGET,
      timeoutMs: 2000,
    });

    const result = await evaluateSpf(context, { domain: "spf.test" });

    expect(result.verdict).toBe("pass");
    expect(
      result.lookups.some((lookup) => lookup.purpose.includes("budget"))
    ).toBe(false);
  });
});
