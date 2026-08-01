import type { ProfileDefinition } from "@propgate/db";
import { runChecks } from "@propgate/dns";
import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { attributeResults, compileProfile, overallVerdict } from "./compile";

/**
 * Compilation and attribution against the real resolver.
 *
 * The unit specs hand `attributeResults` a `CheckResult` someone typed, which
 * proves the filing but not that the shape is the one the evaluators actually
 * return. This is the half that would still pass if the two drifted.
 */

const TIMEOUT_MS = 2000;

async function evaluate(domain: string, definition: ProfileDefinition) {
  const fixture = fixtureTarget("resolver");
  const result = await runChecks({
    domain,
    profile: compileProfile(definition, "version-1"),
    resolver: {
      maxLookups: 60,
      recursionDesired: true,
      target: { address: fixture.address, port: fixture.port },
      timeoutMs: TIMEOUT_MS,
    },
  });

  return attributeResults(definition, result);
}

describe("a partner's profile against a correctly configured customer", () => {
  it("reports every requirement met", async () => {
    const attributed = await evaluate("customer.test", {
      requirements: [
        { check: "spf", include: "one.spf.test", key: "spf" },
        { check: "dkim", key: "dkim", selector: "pg1" },
        { check: "dmarc", key: "dmarc" },
        { check: "mx", expectsMail: false, key: "mail" },
      ],
    });

    expect(attributed.filter((entry) => entry.satisfied)).toHaveLength(4);
    expect(overallVerdict(attributed)).not.toBe("fail");
  });

  it("names the one requirement that is unmet, and only that one", async () => {
    // "3 of 4 requirements met", with the missing one identified — which is
    // what the product promises without rendering instructions.
    const attributed = await evaluate("customer.test", {
      requirements: [
        { check: "spf", include: "one.spf.test", key: "spf" },
        { check: "dkim", key: "dkim-issued", selector: "pg1" },
        { check: "dkim", key: "dkim-rotated", selector: "pg2" },
        { check: "dmarc", key: "dmarc" },
      ],
    });

    const unmet = attributed.filter((entry) => !entry.satisfied);

    expect(attributed).toHaveLength(4);
    expect(unmet.map((entry) => entry.key)).toEqual(["dkim-rotated"]);
    expect(unmet[0]?.findings.length).toBeGreaterThan(0);
    expect(overallVerdict(attributed)).toBe("fail");
  });

  it("keeps two selectors' findings apart, not merged", async () => {
    // Before the per-selector split this was impossible: one DKIM outcome
    // carried both selectors' findings and neither could be filed.
    const attributed = await evaluate("customer.test", {
      requirements: [
        { check: "dkim", key: "issued", selector: "pg1" },
        { check: "dkim", key: "rotated", selector: "pg2" },
      ],
    });

    expect(
      attributed.find((entry) => entry.key === "issued")?.findings
    ).toEqual([]);
    expect(
      attributed.find((entry) => entry.key === "rotated")?.findings.length
    ).toBeGreaterThan(0);
  });

  it("is indeterminate, not failed, when the resolver cannot be reached", async () => {
    // The property the state machine in step 4 is built on: a domain whose
    // check could not complete keeps whatever state it had.
    const definition: ProfileDefinition = {
      requirements: [{ check: "dmarc", key: "dmarc" }],
    };

    const result = await runChecks({
      domain: "customer.test",
      profile: compileProfile(definition, "version-1"),
      resolver: { target: { address: "127.0.0.1", port: 1 }, timeoutMs: 500 },
    });

    expect(overallVerdict(attributeResults(definition, result))).toBe(
      "indeterminate"
    );
  });
});
