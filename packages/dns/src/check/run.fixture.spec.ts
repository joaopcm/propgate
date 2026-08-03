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

describe("DKIM outcomes, per selector", () => {
  it("keeps each selector's answer alongside the merged one", async () => {
    // Both questions are real. "Is DKIM set up" is what a human is shown; a
    // platform that issued two keys tracks two requirements and cannot recover
    // which one is missing from a merged verdict.
    const result = await run("dkim.test", {
      checks: ["dkim"],
      dkimSelectors: ["valid", "revoked"],
      id: "two-selectors",
    });
    const dkim = outcomeFor(result, "dkim");

    expect(dkim?.selectors?.map((entry) => entry.selector)).toEqual([
      "valid",
      "revoked",
    ]);
    expect(dkim?.selectors?.[0]?.verdict).toBe("pass");
    expect(dkim?.selectors?.[1]?.verdict).not.toBe("pass");
    // The merged verdict is still the worst of the parts.
    expect(dkim?.verdict).toBe(dkim?.selectors?.[1]?.verdict);
  });

  it("attributes a finding to the selector that produced it", async () => {
    const result = await run("dkim.test", {
      checks: ["dkim"],
      dkimSelectors: ["valid", "short"],
      id: "two-selectors",
    });
    const selectors = outcomeFor(result, "dkim")?.selectors;

    expect(selectors?.[0]?.findings).toEqual([]);
    expect(selectors?.[1]?.findings.map((finding) => finding.code)).toContain(
      DiagnosisCode.DKIM_KEY_TOO_SHORT
    );
  });

  it("carries the expected key through, so the wrong key is caught", async () => {
    // A selector given as a bare string asks "is a valid key published". Given
    // with the key we issued it asks "is *our* key published", which is what
    // catches a domain that pasted a competitor's record.
    const result = await run("dkim.test", {
      checks: ["dkim"],
      dkimSelectors: [
        {
          expectedPublicKey: "not-the-key-that-is-published",
          selector: "valid",
        },
      ],
      id: "expected-key",
    });

    expect(
      outcomeFor(result, "dkim")?.selectors?.[0]?.findings.map(
        (finding) => finding.code
      )
    ).toContain(DiagnosisCode.DKIM_KEY_MISMATCH);
  });

  it("leaves selectors off every other check", async () => {
    const result = await run("customer.test", sendingOnly(PLATFORM));

    expect(outcomeFor(result, "spf")?.selectors).toBeUndefined();
    expect(outcomeFor(result, "dkim")?.selectors).toHaveLength(1);
  });
});

describe("a zone that answers every name", () => {
  it("says a selector's presence is not evidence it was added", async () => {
    // The failure mode worse than having no product. wildcard.test answers
    // every name, so a naive existence check marks a customer who configured
    // nothing as verified — and the partner acts on that.
    const result = await run("wildcard.test", {
      checks: ["dkim"],
      dkimSelectors: ["never-published"],
      id: "wildcard",
    });

    expect(
      outcomeFor(result, "dkim")?.findings.map((finding) => finding.code)
    ).toContain(DiagnosisCode.WILDCARD_FALSE_POSITIVE);
  });

  it("stays quiet on a zone that publishes what it claims to", async () => {
    const result = await run("customer.test", {
      checks: ["dkim"],
      dkimSelectors: ["pg1"],
      id: "no-wildcard",
    });

    expect(
      outcomeFor(result, "dkim")?.findings.map((finding) => finding.code)
    ).not.toContain(DiagnosisCode.WILDCARD_FALSE_POSITIVE);
  });

  it("costs one lookup for the whole run, not one per selector", async () => {
    // The reason the probe sits above the evaluators. Three selectors would
    // otherwise ask the same question about the zone three times.
    const one = await run("wildcard.test", {
      checks: ["dkim"],
      dkimSelectors: ["a"],
      id: "one",
    });
    const three = await run("wildcard.test", {
      checks: ["dkim"],
      dkimSelectors: ["a", "b", "c"],
      id: "three",
    });

    const probes = (result: CheckResult) =>
      result.lookups.filter((lookup) => lookup.name.includes("_pg-probe-"));

    expect(probes(one)).toHaveLength(1);
    expect(probes(three)).toHaveLength(1);
  });

  it("does not probe when nothing would trust the answer", async () => {
    // A wildcard cannot synthesise the apex, so SPF is unaffected and the
    // lookup would be pure cost.
    const result = await run("customer.test", { checks: ["spf"], id: "spf" });

    expect(
      result.lookups.filter((lookup) => lookup.name.includes("_pg-probe-"))
    ).toHaveLength(0);
  });
});
