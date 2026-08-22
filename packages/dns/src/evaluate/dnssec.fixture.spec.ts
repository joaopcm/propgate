import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import { createEvaluationContext } from "./context";
import { evaluateDelegation } from "./delegation";
import type { EvaluationResult } from "./types";

const TIMEOUT_MS = 2000;

function context(role: Parameters<typeof fixtureTarget>[0]) {
  const fixture = fixtureTarget(role);

  return createEvaluationContext({
    dnssecOk: true,
    recursionDesired: true,
    target: { address: fixture.address, port: fixture.port },
    timeoutMs: TIMEOUT_MS,
  });
}

function codes(result: EvaluationResult): string[] {
  return result.findings.map((finding) => finding.code);
}

describe("a zone whose signatures do not verify", () => {
  it("is reported as bogus rather than as unreachable", async () => {
    const result = await evaluateDelegation(context("resolver"), {
      domain: "bogus-zone.test",
    });

    expect(codes(result)).toContain(DiagnosisCode.DNSSEC_BOGUS);
  });

  it("says so instead of a pile of unreadable-delegation findings", async () => {
    const result = await evaluateDelegation(context("resolver"), {
      domain: "bogus-zone.test",
    });

    expect(codes(result)).toEqual([DiagnosisCode.DNSSEC_BOGUS]);
    expect(result.verdict).toBe("fail");
  });

  it("carries the observation that attributes it", async () => {
    const result = await evaluateDelegation(context("resolver"), {
      domain: "bogus-zone.test",
    });
    const finding = result.findings.find(
      (entry) => entry.code === DiagnosisCode.DNSSEC_BOGUS
    );

    expect(finding?.evidence.observed).toContain("checking disabled");
  });

  it("is invisible to a resolver that does not validate", async () => {
    const result = await evaluateDelegation(context("permissive"), {
      domain: "bogus-zone.test",
    });

    expect(codes(result)).not.toContain(DiagnosisCode.DNSSEC_BOGUS);
  });
});

describe("a delegation left unsigned beneath a signed parent", () => {
  it("is reported, because the parent went to the trouble and this did not", async () => {
    const result = await evaluateDelegation(context("resolver"), {
      domain: "island.secure.test",
    });

    expect(codes(result)).toContain(DiagnosisCode.DNSSEC_INSECURE_ISLAND);
  });

  it("reads as insecure, never as bogus", async () => {
    const result = await evaluateDelegation(context("resolver"), {
      domain: "island.secure.test",
    });

    expect(codes(result)).not.toContain(DiagnosisCode.DNSSEC_BOGUS);
  });

  it("names the signed parent, so the gap is obvious", async () => {
    const result = await evaluateDelegation(context("resolver"), {
      domain: "island.secure.test",
    });
    const finding = result.findings.find(
      (entry) => entry.code === DiagnosisCode.DNSSEC_INSECURE_ISLAND
    );

    expect(finding?.evidence.observed).toContain("secure.test");
    expect(finding?.severity).toBe("warning");
  });

  it("says nothing about an org domain under a signed TLD", async () => {
    const result = await evaluateDelegation(context("resolver"), {
      domain: "insecure-island.test",
    });

    expect(codes(result)).not.toContain(DiagnosisCode.DNSSEC_INSECURE_ISLAND);
  });

  it("says nothing about a child that is properly vouched for", async () => {
    const result = await evaluateDelegation(context("resolver"), {
      domain: "secure.test",
    });

    expect(codes(result)).not.toContain(DiagnosisCode.DNSSEC_INSECURE_ISLAND);
  });
});

describe("a correctly signed zone", () => {
  it("produces neither finding", async () => {
    const result = await evaluateDelegation(context("resolver"), {
      domain: "secure.test",
    });

    expect(codes(result)).not.toContain(DiagnosisCode.DNSSEC_BOGUS);
  });
});
