import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import type { ServerAddress } from "../types";
import { createEvaluationContext } from "./context";
import { evaluateDkim } from "./dkim";
import { evaluateSpf } from "./spf";
import type { EvaluationResult } from "./types";

const TIMEOUT_MS = 2000;

function target(role: Parameters<typeof fixtureTarget>[0]): ServerAddress {
  const fixture = fixtureTarget(role);
  return { address: fixture.address, port: fixture.port };
}

function context(role: Parameters<typeof fixtureTarget>[0] = "resolver") {
  return createEvaluationContext({
    recursionDesired: role === "resolver",
    target: target(role),
    timeoutMs: TIMEOUT_MS,
  });
}

function codes(result: EvaluationResult): string[] {
  return result.findings.map((finding) => finding.code);
}

describe("NODATA is not NXDOMAIN", () => {
  it("says the name exists when it does", async () => {
    const result = await evaluateSpf(context(), { domain: "nodata.test" });

    expect(codes(result)).toContain(DiagnosisCode.SPF_RECORD_MISSING);
    expect(codes(result)).toContain(DiagnosisCode.NODATA_NOT_NXDOMAIN);
  });

  it("stays quiet when the name genuinely does not exist", async () => {
    const result = await evaluateSpf(context(), {
      domain: "nothing-here.spf.test",
    });

    expect(codes(result)).toContain(DiagnosisCode.SPF_RECORD_MISSING);
    expect(codes(result)).not.toContain(DiagnosisCode.NODATA_NOT_NXDOMAIN);
  });
});

describe("how long the absence will be remembered", () => {
  it("warns when a negative answer is cached for an hour", async () => {
    const result = await evaluateSpf(context("auth"), {
      domain: "negcache-high.test",
    });

    expect(codes(result)).toContain(DiagnosisCode.NEGATIVE_CACHE_LIKELY);

    const finding = result.findings.find(
      (entry) => entry.code === DiagnosisCode.NEGATIVE_CACHE_LIKELY
    );

    expect(finding?.evidence.observed).toBe("3600s");
  });

  it("stays quiet at a minute, which nobody notices", async () => {
    const result = await evaluateSpf(context(), {
      domain: "negcache-low.test",
    });

    expect(codes(result)).not.toContain(DiagnosisCode.NEGATIVE_CACHE_LIKELY);
  });
});

describe("an answer that arrived over TCP", () => {
  it("is reported, because it is a hair away from not arriving", async () => {
    const result = await evaluateDkim(context("auth"), {
      domain: "tcp.test",
      selector: "big4096",
    });

    expect(codes(result)).toContain(DiagnosisCode.TRUNCATED_FELL_BACK_TO_TCP);
    expect(codes(result)).not.toContain(DiagnosisCode.DKIM_RECORD_MISSING);
    expect(result.verdict).toBe("pass");
  });
});
