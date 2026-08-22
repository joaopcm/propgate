import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import type { ServerAddress } from "../types";
import { createEvaluationContext } from "./context";
import { evaluateSpf } from "./spf";

const fixture = fixtureTarget("auth");
const TARGET: ServerAddress = {
  address: fixture.address,
  port: fixture.port,
};

describe("the evaluation deadline", () => {
  it("stops spending lookups once the budget is gone", async () => {
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
