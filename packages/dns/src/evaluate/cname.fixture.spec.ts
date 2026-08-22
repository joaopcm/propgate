import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import type { ServerAddress } from "../types";
import type { CnameCheck } from "./cname";
import { evaluateCname } from "./cname";
import { createEvaluationContext } from "./context";
import type { EvaluationResult } from "./types";

const TIMEOUT_MS = 2000;
const TARGET = "track.propgate-fixture.test";

function target(role: Parameters<typeof fixtureTarget>[0]): ServerAddress {
  const fixture = fixtureTarget(role);
  return { address: fixture.address, port: fixture.port };
}

async function evaluate(check: CnameCheck): Promise<EvaluationResult> {
  return await evaluateCname(
    createEvaluationContext({ target: target("auth"), timeoutMs: TIMEOUT_MS }),
    check
  );
}

function codes(result: EvaluationResult): string[] {
  return result.findings.map((finding) => finding.code);
}

function evidenceOf(result: EvaluationResult, code: string) {
  return result.findings.find((finding) => finding.code === code)?.evidence;
}

describe("an alias published as issued", () => {
  it("passes on one lookup", async () => {
    const result = await evaluate({
      domain: "ok.cname.test",
      label: "track",
      target: TARGET,
    });

    expect(result.verdict).toBe("pass");
    expect(result.findings).toHaveLength(0);
    expect(result.lookups).toHaveLength(1);
    expect(result.lookups[0]?.name).toBe("track.ok.cname.test");
  });

  it("accepts a target written absolute, since names do not carry a dot", async () => {
    const result = await evaluate({
      domain: "ok.cname.test",
      label: "track",
      target: `${TARGET}.`,
    });

    expect(result.verdict).toBe("pass");
  });
});

describe("a provider that flattened the alias", () => {
  it("passes, and says the record is ours rather than broken", async () => {
    const result = await evaluate({
      domain: "flat.cname.test",
      label: "track",
      target: TARGET,
    });

    expect(result.verdict).toBe("pass");
    expect(codes(result)).toEqual([DiagnosisCode.PROVIDER_FLATTENED_CNAME]);
    expect(
      evidenceOf(result, DiagnosisCode.PROVIDER_FLATTENED_CNAME)
    ).toMatchObject({ observed: "198.51.100.20" });
  });

  it("fails when one of our addresses sits beside a stranger's", async () => {
    const result = await evaluate({
      domain: "partial.cname.test",
      label: "track",
      target: TARGET,
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toEqual([DiagnosisCode.CNAME_TARGET_PARTIAL]);
    expect(
      evidenceOf(result, DiagnosisCode.CNAME_TARGET_PARTIAL)
    ).toMatchObject({ observed: "203.0.113.5" });
  });

  it("fails when the stranger is in the other address family", async () => {
    const result = await evaluate({
      domain: "v6.cname.test",
      label: "track",
      target: TARGET,
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toEqual([DiagnosisCode.CNAME_TARGET_PARTIAL]);
    expect(
      evidenceOf(result, DiagnosisCode.CNAME_TARGET_PARTIAL)
    ).toMatchObject({ observed: "2001:db8::bad" });
  });

  it("passes a dual-stack flattening where both families are ours", async () => {
    const result = await evaluate({
      domain: "dual.cname.test",
      label: "track",
      target: TARGET,
    });

    expect(result.verdict).toBe("pass");
    expect(codes(result)).toEqual([DiagnosisCode.PROVIDER_FLATTENED_CNAME]);
  });

  it("passes one family of a dual-stack target, since a subset is still ours", async () => {
    const result = await evaluate({
      domain: "flat.cname.test",
      label: "track",
      target: TARGET,
    });

    expect(result.verdict).toBe("pass");
  });

  it("fails an address record that is not the target's", async () => {
    const result = await evaluate({
      domain: "wrong.cname.test",
      label: "track",
      target: TARGET,
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toEqual([DiagnosisCode.CNAME_TARGET_MISMATCH]);
    expect(
      evidenceOf(result, DiagnosisCode.CNAME_TARGET_MISMATCH)
    ).toMatchObject({ observed: "203.0.113.5" });
  });
});

describe("an alias pointed somewhere else", () => {
  it("reports the target it found", async () => {
    const result = await evaluate({
      domain: "stale.cname.test",
      label: "track",
      target: TARGET,
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toEqual([DiagnosisCode.CNAME_TARGET_MISMATCH]);
    expect(
      evidenceOf(result, DiagnosisCode.CNAME_TARGET_MISMATCH)
    ).toMatchObject({ expected: TARGET, observed: "track.competitor.invalid" });
  });

  it("blames the provider when our target is there with a zone appended", async () => {
    const result = await evaluate({
      domain: "appended.test",
      label: "link",
      target: TARGET,
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toEqual([DiagnosisCode.PROVIDER_APPENDED_ZONE_NAME]);
  });

  it("blames it too when the customer's own zone was appended instead", async () => {
    const result = await evaluate({
      domain: "appended.test",
      label: "mail",
      target: "bounce.propgate-fixture.test",
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toEqual([DiagnosisCode.PROVIDER_APPENDED_ZONE_NAME]);
  });
});

describe("an alias that is not there", () => {
  it("reports the name as empty rather than as pointing wrongly", async () => {
    const result = await evaluate({
      domain: "missing.cname.test",
      label: "track",
      target: TARGET,
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.CNAME_RECORD_MISSING);
    expect(codes(result)).not.toContain(DiagnosisCode.CNAME_TARGET_MISMATCH);
  });

  it("finds it at the doubled name a provider would have written", async () => {
    const result = await evaluate({
      domain: "appended.test",
      label: "track",
      target: TARGET,
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toEqual([DiagnosisCode.PROVIDER_APPENDED_ZONE_NAME]);
  });

  it("does not blame the provider when the doubled name points elsewhere", async () => {
    const result = await evaluate({
      domain: "appended.test",
      label: "track",
      target: "somewhere.propgate-fixture.test",
    });

    expect(codes(result)).not.toContain(
      DiagnosisCode.PROVIDER_APPENDED_ZONE_NAME
    );
    expect(codes(result)).toContain(DiagnosisCode.CNAME_RECORD_MISSING);
  });
});
