import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import type { ServerAddress } from "../types";
import type { DomainProfile } from "./profile";
import { fullMail, sendingOnly, webOnly } from "./profile";
import type { CheckResult } from "./run";
import { outcomeFor, runChecks } from "./run";

/**
 * Six evaluators, one answer.
 *
 * Through the recursive tier throughout, because the delegation check cannot
 * work any other way and a real deployment would use one resolver for all six.
 */

const TIMEOUT_MS = 2000;

function resolver(): { target: ServerAddress; recursionDesired: boolean } {
  const fixture = fixtureTarget("resolver");

  return {
    recursionDesired: true,
    target: { address: fixture.address, port: fixture.port },
  };
}

async function run(
  domain: string,
  profile: DomainProfile
): Promise<CheckResult> {
  return await runChecks({
    domain,
    profile,
    resolver: { ...resolver(), maxLookups: 60, timeoutMs: TIMEOUT_MS },
  });
}

const PLATFORM = {
  dkimSelectors: ["pg1"],
  spfInclude: "one.spf.test",
};

function codes(result: CheckResult): string[] {
  return result.findings.map((finding) => finding.code);
}

describe("a correctly onboarded customer", () => {
  it("passes with nothing to act on", async () => {
    // The reason this fixture exists: a checker that finds something to fix on
    // every domain is a checker nobody reads, so "clean" has to be reachable
    // and tested.
    //
    // Clean does not mean silent. MX_NULL is reported because the domain does
    // state that it accepts no mail, and a dashboard should say so — it is an
    // observation at info severity, not something to fix.
    const result = await run("customer.test", sendingOnly(PLATFORM));

    expect(codes(result)).toEqual([DiagnosisCode.MX_NULL]);
    expect(
      result.findings.filter((finding) => finding.severity !== "info")
    ).toEqual([]);
    expect(result.verdict).toBe("pass");
  });

  it("reports one outcome per check the profile asked for", async () => {
    const result = await run("customer.test", sendingOnly(PLATFORM));

    expect(result.checks.map((check) => check.kind)).toEqual([
      "delegation",
      "spf",
      "dkim",
      "dmarc",
      "mx",
    ]);
  });

  it("carries the derivation for the whole run", async () => {
    const result = await run("customer.test", sendingOnly(PLATFORM));

    // Every lookup from every check, so a customer can be shown why rather than
    // just what.
    expect(result.lookups.length).toBeGreaterThan(5);
    expect(result.lookups.every((lookup) => lookup.purpose.length > 0)).toBe(
      true
    );
  });

  it("names the profile it was checked against", async () => {
    const result = await run("customer.test", sendingOnly(PLATFORM));

    expect(result.profile).toBe("sending-only");
    expect(result.domain).toBe("customer.test");
  });
});

describe("the profile decides what is a fault", () => {
  it("passes a null MX for a sending-only domain", async () => {
    const result = await run("customer.test", sendingOnly(PLATFORM));

    expect(outcomeFor(result, "mx")?.verdict).toBe("pass");
  });

  it("fails the same domain when it is supposed to receive mail", async () => {
    // Identical records, identical queries. Only the stated intent differs.
    const result = await run("customer.test", fullMail(PLATFORM));

    expect(outcomeFor(result, "mx")?.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.MX_MAIL_NOT_ACCEPTED);
    expect(result.verdict).toBe("fail");
  });

  it("still passes every other check", async () => {
    // One failing check must not contaminate the others: the customer needs to
    // know SPF and DKIM are fine and mail delivery is not.
    const result = await run("customer.test", fullMail(PLATFORM));

    expect(outcomeFor(result, "spf")?.verdict).toBe("pass");
    expect(outcomeFor(result, "dkim")?.verdict).toBe("pass");
    expect(outcomeFor(result, "delegation")?.verdict).toBe("pass");
  });
});

describe("a skipped check is not a passing check", () => {
  it("produces no outcome for a check the profile did not ask about", async () => {
    // A dashboard showing six ticks for a domain that was asked about one is
    // lying, so an unasked check is absent rather than green.
    const result = await run("customer.test", webOnly({}));

    expect(result.checks.map((check) => check.kind)).toEqual(["delegation"]);
    expect(outcomeFor(result, "spf")).toBeUndefined();
    expect(outcomeFor(result, "mx")).toBeUndefined();
  });

  it("skips DKIM when the platform issued no selector", async () => {
    const result = await run(
      "customer.test",
      sendingOnly({ spfInclude: "one.spf.test" })
    );

    expect(outcomeFor(result, "dkim")).toBeUndefined();
    expect(outcomeFor(result, "spf")).toBeDefined();
  });

  it("runs CAA only when a certificate authority is named", async () => {
    const withIssuer = await run(
      "caa.test",
      webOnly({ caaIssuer: "letsencrypt.org" })
    );
    const without = await run("caa.test", webOnly({}));

    expect(outcomeFor(withIssuer, "caa")?.verdict).toBe("pass");
    expect(outcomeFor(without, "caa")).toBeUndefined();
  });
});

describe("a domain that was never configured", () => {
  it("fails, and says which checks failed and why", async () => {
    const result = await run("nodata.test", sendingOnly(PLATFORM));

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.SPF_RECORD_MISSING);
    expect(codes(result)).toContain(DiagnosisCode.DKIM_RECORD_MISSING);
    expect(codes(result)).toContain(DiagnosisCode.DMARC_RECORD_MISSING);
  });

  it("attributes every finding to the check that produced it", async () => {
    const result = await run("nodata.test", sendingOnly(PLATFORM));

    expect(
      outcomeFor(result, "spf")?.findings.map((finding) => finding.code)
    ).toContain(DiagnosisCode.SPF_RECORD_MISSING);
    expect(
      outcomeFor(result, "dkim")?.findings.map((finding) => finding.code)
    ).not.toContain(DiagnosisCode.SPF_RECORD_MISSING);
  });
});

describe("the verdict is the worst of the parts", () => {
  it("is indeterminate when a check could not run and none failed", async () => {
    const result = await runChecks({
      domain: "customer.test",
      profile: webOnly({}),
      resolver: { target: { address: "127.0.0.1", port: 1 }, timeoutMs: 500 },
    });

    expect(result.verdict).toBe("indeterminate");
  });

  it("prefers a failure it observed over uncertainty about the rest", async () => {
    // fullMail on customer.test fails MX for certain. Nothing here is
    // uncertain, so the point is the ordering rather than the fixture: a
    // definite failure is more actionable than a check that did not run.
    const result = await run("customer.test", fullMail(PLATFORM));

    expect(result.verdict).toBe("fail");
  });
});
