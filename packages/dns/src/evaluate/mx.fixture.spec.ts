import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import type { ServerAddress } from "../types";
import { createEvaluationContext } from "./context";
import type { MxCheck } from "./mx";
import { evaluateMx } from "./mx";
import type { EvaluationResult, Evidence } from "./types";

const TIMEOUT_MS = 2000;

function target(role: Parameters<typeof fixtureTarget>[0]): ServerAddress {
  const fixture = fixtureTarget(role);
  return { address: fixture.address, port: fixture.port };
}

async function evaluate(check: MxCheck): Promise<EvaluationResult> {
  const context = createEvaluationContext({
    target: target("auth"),
    timeoutMs: TIMEOUT_MS,
  });

  return await evaluateMx(context, check);
}

function codes(result: EvaluationResult): string[] {
  return result.findings.map((finding) => finding.code);
}

function evidenceFor(result: EvaluationResult, code: DiagnosisCode): Evidence {
  return (
    result.findings.find((finding) => finding.code === code)?.evidence ?? {}
  );
}

describe("a domain that receives mail properly", () => {
  it("reports nothing", async () => {
    const result = await evaluate({ domain: "mx.test" });

    expect(codes(result)).toEqual([]);
    expect(result.verdict).toBe("pass");
  });

  it("resolves every exchange", async () => {
    const result = await evaluate({ domain: "mx.test" });

    expect(result.lookups.map((lookup) => lookup.name)).toEqual([
      "mx.test",
      "mail1.mx.test",
      "mail2.mx.test",
    ]);
  });
});

describe("a null MX means different things to different domains", () => {
  it("is correct for a domain that only sends", async () => {
    const result = await evaluate({
      domain: "nomail.mx.test",
      expectsMail: false,
    });

    expect(codes(result)).toEqual([DiagnosisCode.MX_NULL]);
    expect(result.verdict).toBe("pass");
  });

  it("is a failure for a domain that expects mail", async () => {
    const result = await evaluate({
      domain: "nomail.mx.test",
      expectsMail: true,
    });

    expect(codes(result)).toContain(DiagnosisCode.MX_NULL);
    expect(codes(result)).toContain(DiagnosisCode.MX_MAIL_NOT_ACCEPTED);
    expect(result.verdict).toBe("fail");
  });

  it("says nothing about delivery when the caller did not state an intent", async () => {
    const result = await evaluate({ domain: "nomail.mx.test" });

    expect(codes(result)).toEqual([DiagnosisCode.MX_NULL]);
    expect(result.verdict).toBe("pass");
  });

  it("rejects a null MX published alongside a real one", async () => {
    const result = await evaluate({
      domain: "ambiguous.mx.test",
      expectsMail: false,
    });

    expect(codes(result)).toContain(DiagnosisCode.MX_NULL_WITH_OTHER_RECORDS);
    expect(
      evidenceFor(result, DiagnosisCode.MX_NULL_WITH_OTHER_RECORDS).observed
    ).toBe("mail1.mx.test");
    expect(result.verdict).toBe("fail");
  });
});

describe("exchanges that cannot receive anything", () => {
  it("reports an exchange with no address of either family", async () => {
    const result = await evaluate({ domain: "dangling.mx.test" });

    expect(codes(result)).toContain(DiagnosisCode.MX_TARGET_UNRESOLVABLE);
    expect(
      evidenceFor(result, DiagnosisCode.MX_TARGET_UNRESOLVABLE).observed
    ).toBe("nowhere.mx.test");
    expect(result.verdict).toBe("fail");
  });

  it("accepts an IPv6-only exchange", async () => {
    const result = await evaluate({ domain: "sixth.mx.test" });

    expect(codes(result)).toEqual([]);
    expect(result.verdict).toBe("pass");
  });

  it("reports an address written where a name belongs", async () => {
    const result = await evaluate({ domain: "literal.mx.test" });

    expect(codes(result)).toContain(DiagnosisCode.MX_TARGET_IS_IP_LITERAL);
    expect(
      evidenceFor(result, DiagnosisCode.MX_TARGET_IS_IP_LITERAL).observed
    ).toBe("198.51.100.80");
  });

  it("does not spend a lookup on an address literal", async () => {
    const result = await evaluate({ domain: "literal.mx.test" });

    expect(result.lookups).toHaveLength(1);
  });
});

describe("an aliased exchange", () => {
  it("is a warning, not a failure", async () => {
    const result = await evaluate({ domain: "aliased.mx.test" });

    expect(codes(result)).toContain(DiagnosisCode.MX_TARGET_IS_CNAME);
    expect(codes(result)).not.toContain(DiagnosisCode.MX_MAIL_NOT_ACCEPTED);
    expect(result.verdict).toBe("warn");
  });
});

describe("no MX at all", () => {
  it("reports delivery falling back to the address record", async () => {
    const result = await evaluate({ domain: "implicit.mx.test" });

    expect(codes(result)).toContain(DiagnosisCode.MX_RECORDS_MISSING);
    expect(codes(result)).toContain(DiagnosisCode.MX_IMPLICIT_A);
    expect(codes(result)).not.toContain(DiagnosisCode.MX_MAIL_NOT_ACCEPTED);
    expect(result.verdict).toBe("warn");
  });

  it("fails when there is no address either", async () => {
    const result = await evaluate({
      domain: "undeliverable.mx.test",
      expectsMail: true,
    });

    expect(codes(result)).toContain(DiagnosisCode.MX_MAIL_NOT_ACCEPTED);
    expect(result.verdict).toBe("fail");
  });

  it("says nothing about delivery for a sending-only domain", async () => {
    const result = await evaluate({
      domain: "undeliverable.mx.test",
      expectsMail: false,
    });

    expect(codes(result)).not.toContain(DiagnosisCode.MX_MAIL_NOT_ACCEPTED);
  });
});

describe("uncertainty is not failure", () => {
  it("returns indeterminate when the server is unreachable", async () => {
    const context = createEvaluationContext({
      target: { address: "127.0.0.1", port: 1 },
      timeoutMs: 500,
    });

    const result = await evaluateMx(context, { domain: "mx.test" });

    expect(result.verdict).toBe("indeterminate");
    expect(codes(result)).not.toContain(DiagnosisCode.MX_RECORDS_MISSING);
  });
});
