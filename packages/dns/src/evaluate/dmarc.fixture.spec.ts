import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import type { ServerAddress } from "../types";
import { createEvaluationContext } from "./context";
import type { DmarcCheck } from "./dmarc";
import { evaluateDmarc } from "./dmarc";
import type { EvaluationResult } from "./types";

/**
 * DMARC against real servers.
 *
 * The point of most of these is **discovery order**: RFC 7489 §6.6.3 queries the
 * exact name first and only falls back to the organizational domain. An earlier
 * comment in this repo stated it backwards, so the difference is asserted here
 * rather than described.
 */

const TIMEOUT_MS = 2000;

function target(): ServerAddress {
  const fixture = fixtureTarget("auth");
  return { address: fixture.address, port: fixture.port };
}

async function evaluate(check: DmarcCheck): Promise<EvaluationResult> {
  const context = createEvaluationContext({
    target: target(),
    timeoutMs: TIMEOUT_MS,
  });

  return await evaluateDmarc(context, check);
}

function codes(result: EvaluationResult): string[] {
  return result.findings.map((finding) => finding.code);
}

describe("discovery order", () => {
  it("uses a subdomain's own policy, not the organizational one", async () => {
    // own.dmarc.test publishes p=none. The org domain publishes p=reject with
    // sp=quarantine. The subdomain's own record wins, so this is p=none — and
    // the sp= at the parent is irrelevant.
    const result = await evaluate({
      checkExternalReports: false,
      domain: "own.dmarc.test",
    });

    expect(codes(result)).toContain(DiagnosisCode.DMARC_POLICY_NONE);
    expect(codes(result)).not.toContain(DiagnosisCode.DMARC_POLICY_INHERITED);

    // One lookup: the exact name answered, so no fallback was needed.
    expect(result.lookups).toHaveLength(1);
    expect(result.lookups[0]?.name).toBe("_dmarc.own.dmarc.test");
  });

  it("falls back to the organizational domain and applies sp=", async () => {
    // inherit.dmarc.test publishes nothing, so the org policy governs — via
    // sp=quarantine rather than p=reject.
    const result = await evaluate({
      checkExternalReports: false,
      domain: "inherit.dmarc.test",
    });

    expect(codes(result)).toContain(DiagnosisCode.DMARC_POLICY_INHERITED);

    const inherited = result.findings.find(
      (finding) => finding.code === DiagnosisCode.DMARC_POLICY_INHERITED
    );
    expect(inherited?.evidence.detail).toContain("sp=quarantine");

    // Two lookups, in the order the RFC requires.
    expect(result.lookups.map((lookup) => lookup.name)).toEqual([
      "_dmarc.inherit.dmarc.test",
      "_dmarc.dmarc.test",
    ]);
    expect(result.lookups[1]?.purpose).toContain("organizational domain");
  });

  it("does not report an inherited policy as missing", async () => {
    const result = await evaluate({
      checkExternalReports: false,
      domain: "inherit.dmarc.test",
    });

    expect(codes(result)).not.toContain(DiagnosisCode.DMARC_RECORD_MISSING);
  });

  it("reports missing when neither the name nor its org domain has a policy", async () => {
    const result = await evaluate({
      checkExternalReports: false,
      domain: "sub.nodata.test",
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toEqual([DiagnosisCode.DMARC_RECORD_MISSING]);
  });

  it("never falls back past the organizational domain", async () => {
    // dmarc.test IS the org domain, so there is nothing above it to try. A
    // second lookup here would mean climbing toward the public suffix.
    const result = await evaluate({
      checkExternalReports: false,
      domain: "dmarc.test",
    });

    expect(result.lookups).toHaveLength(1);
  });
});

describe("policy strength", () => {
  it("warns on p=none, which enforces nothing", async () => {
    const result = await evaluate({
      checkExternalReports: false,
      domain: "monitor.dmarc.test",
    });

    expect(result.verdict).toBe("warn");
    expect(codes(result)).toContain(DiagnosisCode.DMARC_POLICY_NONE);
  });

  it("warns when pct< 100 leaves most failures delivered", async () => {
    const result = await evaluate({
      checkExternalReports: false,
      domain: "partial.dmarc.test",
    });

    expect(result.verdict).toBe("warn");
    expect(codes(result)).toContain(DiagnosisCode.DMARC_POLICY_PARTIAL);

    const finding = result.findings.find(
      (f) => f.code === DiagnosisCode.DMARC_POLICY_PARTIAL
    );
    expect(finding?.evidence.observed).toBe("pct=20");
  });

  it("passes a strict policy with same-domain reporting", async () => {
    const result = await evaluate({ domain: "dmarc.test" });

    expect(result.verdict).toBe("pass");
    expect(result.findings).toHaveLength(0);
  });
});

describe("malformed policies", () => {
  it("treats two records as no policy at all", async () => {
    const result = await evaluate({
      checkExternalReports: false,
      domain: "multi.dmarc.test",
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.DMARC_MULTIPLE_RECORDS);
  });

  it("ignores an unrelated TXT sharing the name", async () => {
    // Filtering happens before counting, so one policy plus a verification
    // token is one policy.
    const result = await evaluate({
      checkExternalReports: false,
      domain: "shared.dmarc.test",
    });

    expect(codes(result)).not.toContain(DiagnosisCode.DMARC_MULTIPLE_RECORDS);
    expect(result.verdict).toBe("pass");
  });

  it("does not recognise a record whose v= is not first", async () => {
    // A receiver would not see this as DMARC either, so the honest report is
    // that the domain has no policy — and the org-domain fallback then runs.
    const result = await evaluate({
      checkExternalReports: false,
      domain: "vlast.dmarc.test",
    });

    expect(codes(result)).toContain(DiagnosisCode.DMARC_POLICY_INHERITED);
  });

  it("reports a record with no p= as malformed", async () => {
    const result = await evaluate({
      checkExternalReports: false,
      domain: "nopolicy.dmarc.test",
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.DMARC_RECORD_MALFORMED);
    const finding = result.findings.at(-1);
    expect(finding?.evidence.detail).toContain("no p=");
  });

  it("reports an unknown policy value", async () => {
    const result = await evaluate({
      checkExternalReports: false,
      domain: "badpolicy.dmarc.test",
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.DMARC_RECORD_MALFORMED);
  });

  it("reports pct above 100", async () => {
    const result = await evaluate({
      checkExternalReports: false,
      domain: "badpct.dmarc.test",
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.DMARC_RECORD_MALFORMED);
  });
});

describe("external report authorization", () => {
  it("passes when the destination has authorised the source", async () => {
    // reports.test publishes dmarc.test._report._dmarc, per RFC 7489 §7.1.
    const result = await evaluate({ domain: "authorized.dmarc.test" });

    expect(codes(result)).not.toContain(
      DiagnosisCode.DMARC_EXTERNAL_REPORT_UNAUTHORIZED
    );

    const authz = result.lookups.find((lookup) =>
      lookup.name.includes("_report._dmarc")
    );
    expect(authz?.name).toBe("dmarc.test._report._dmarc.reports.test");
  });

  it("fails when the destination has not, since reports vanish silently", async () => {
    const result = await evaluate({ domain: "unauthorized.dmarc.test" });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(
      DiagnosisCode.DMARC_EXTERNAL_REPORT_UNAUTHORIZED
    );

    const finding = result.findings.find(
      (f) => f.code === DiagnosisCode.DMARC_EXTERNAL_REPORT_UNAUTHORIZED
    );
    // The evidence names the exact record that has to be created.
    expect(finding?.evidence.expected).toContain(
      "dmarc.test._report._dmarc.unauth-reports.test"
    );
    expect(finding?.evidence.detail).toContain("discarded");
  });

  it("does not check authorization for a same-domain address", async () => {
    // rua=mailto:agg@dmarc.test needs no authorization, so no lookup for it.
    const result = await evaluate({ domain: "dmarc.test" });

    expect(
      result.lookups.some((lookup) => lookup.name.includes("_report._dmarc"))
    ).toBe(false);
  });

  it("can be skipped, and then costs no lookups", async () => {
    const withCheck = await evaluate({ domain: "unauthorized.dmarc.test" });
    const without = await evaluate({
      checkExternalReports: false,
      domain: "unauthorized.dmarc.test",
    });

    expect(without.lookups.length).toBeLessThan(withCheck.lookups.length);
    expect(without.verdict).toBe("pass");
  });

  it("warns about a report address that is not a URI", async () => {
    const result = await evaluate({ domain: "baduri.dmarc.test" });

    expect(codes(result)).toContain(DiagnosisCode.DMARC_REPORT_URI_INVALID);
    const finding = result.findings.find(
      (f) => f.code === DiagnosisCode.DMARC_REPORT_URI_INVALID
    );
    expect(finding?.evidence.detail).toContain("mailto:");
  });
});

describe("uncertainty is not failure", () => {
  it("returns indeterminate when the server is unreachable", async () => {
    const context = createEvaluationContext({
      target: { address: "127.0.0.1", port: 1 },
      timeoutMs: 500,
    });

    const result = await evaluateDmarc(context, { domain: "dmarc.test" });

    expect(result.verdict).toBe("indeterminate");
    expect(result.findings).toHaveLength(0);
  });
});
