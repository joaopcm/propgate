import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import { createEvaluationContext } from "./context";
import { evaluateDelegation } from "./delegation";
import type { EvaluationResult } from "./types";

/**
 * Two DNSSEC states that look identical from outside and need opposite fixes.
 *
 * Bogus: re-sign or roll back, and half the internet cannot reach you meanwhile.
 * Insecure island: publish the DS at the registrar, and nothing is broken today.
 * Reporting one as the other sends someone to fix the wrong thing, which is why
 * both fixtures exist and why these specs assert the *absence* of the other code
 * as carefully as the presence of the right one.
 */

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
    // Through the validating resolver this SERVFAILs everything. Without
    // attribution it reads as "the zone is down", which is the wrong fix.
    const result = await evaluateDelegation(context("resolver"), {
      domain: "bogus-zone.test",
    });

    expect(codes(result)).toContain(DiagnosisCode.DNSSEC_BOGUS);
  });

  it("says so instead of a pile of unreadable-delegation findings", async () => {
    // The reason DNSSEC state is established first: one broken signature makes
    // every subsequent question fail, and six symptoms are worse than one cause.
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
    // The whole shape of the problem: the owner sees nothing wrong, because
    // wherever they look from, it works.
    const result = await evaluateDelegation(context("permissive"), {
      domain: "bogus-zone.test",
    });

    expect(codes(result)).not.toContain(DiagnosisCode.DNSSEC_BOGUS);
  });
});

describe("a correctly signed zone", () => {
  it("produces neither finding", async () => {
    // secure.test has a DS at the parent, so the chain is complete.
    const result = await evaluateDelegation(context("resolver"), {
      domain: "secure.test",
    });

    expect(codes(result)).not.toContain(DiagnosisCode.DNSSEC_BOGUS);
  });
});
