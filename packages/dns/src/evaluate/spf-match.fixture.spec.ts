import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import type { ServerAddress } from "../types";
import { createEvaluationContext } from "./context";
import type { SpfCheck } from "./spf";
import { evaluateSpf } from "./spf";
import type { EvaluationResult, Evidence } from "./types";

const TIMEOUT_MS = 2000;

function target(role: Parameters<typeof fixtureTarget>[0]): ServerAddress {
  const fixture = fixtureTarget(role);
  return { address: fixture.address, port: fixture.port };
}

async function evaluate(check: SpfCheck): Promise<EvaluationResult> {
  const context = createEvaluationContext({
    maxLookups: 60,
    target: target("auth"),
    timeoutMs: TIMEOUT_MS,
  });

  return await evaluateSpf(context, check);
}

function codes(result: EvaluationResult): string[] {
  return result.findings.map((finding) => finding.code);
}

function evidenceFor(result: EvaluationResult, code: DiagnosisCode): Evidence {
  return (
    result.findings.find((finding) => finding.code === code)?.evidence ?? {}
  );
}

function ipOutcome(result: EvaluationResult): string | undefined {
  return codes(result).find((code) => code.startsWith("SPF_IP_"));
}

describe("ip4 and ip6 mechanisms", () => {
  it("authorises a host inside the range", async () => {
    const result = await evaluate({
      domain: "one.spf.test",
      ip: "198.51.100.7",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_AUTHORIZED);
  });

  it("rejects a host outside it, naming the mechanism that decided", async () => {
    const result = await evaluate({
      domain: "one.spf.test",
      ip: "203.0.113.7",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_NOT_AUTHORIZED);
    expect(
      evidenceFor(result, DiagnosisCode.SPF_IP_NOT_AUTHORIZED).detail
    ).toContain("-all");
    expect(result.verdict).toBe("fail");
  });

  it("matches an IPv6 host against an ip6 range", async () => {
    const result = await evaluate({
      domain: "ip6only.spf.test",
      ip: "2001:db8:1234::9",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_AUTHORIZED);
  });

  it("never matches across families", async () => {
    const result = await evaluate({
      domain: "ip6only.spf.test",
      ip: "198.51.100.7",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_NOT_AUTHORIZED);
  });

  it("treats an IPv4-mapped address as IPv4", async () => {
    const result = await evaluate({
      domain: "one.spf.test",
      ip: "::ffff:198.51.100.7",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_AUTHORIZED);
    expect(evidenceFor(result, DiagnosisCode.SPF_IP_AUTHORIZED).observed).toBe(
      "::ffff:198.51.100.7"
    );
  });
});

describe("qualifiers decide the outcome, not the record's all", () => {
  it("reports a softfail from ~ on the matching mechanism", async () => {
    const result = await evaluate({
      domain: "qualifiers.spf.test",
      ip: "198.51.100.10",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_SOFTFAIL);
    expect(result.verdict).toBe("warn");
  });

  it("reports neutral from ? on the matching mechanism", async () => {
    const result = await evaluate({
      domain: "qualifiers.spf.test",
      ip: "198.51.100.11",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_NEUTRAL);
  });

  it("falls through to all when nothing matches", async () => {
    const result = await evaluate({
      domain: "qualifiers.spf.test",
      ip: "198.51.100.99",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_NOT_AUTHORIZED);
  });

  it("stops at the first match, not the best one", async () => {
    const result = await evaluate({
      domain: "qualifiers.spf.test",
      ip: "198.51.100.10",
    });

    expect(evidenceFor(result, DiagnosisCode.SPF_IP_SOFTFAIL).detail).toContain(
      "~ip4:198.51.100.10"
    );
  });
});

describe("a record that matches nothing", () => {
  it("is neutral by default when there is no all", async () => {
    const result = await evaluate({
      domain: "noall.spf.test",
      ip: "203.0.113.9",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_NEUTRAL);
  });
});

describe("the a mechanism", () => {
  it("matches the host's own address", async () => {
    const result = await evaluate({
      domain: "amech.spf.test",
      ip: "198.51.100.30",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_AUTHORIZED);
  });

  it("does not match a neighbour without a prefix", async () => {
    const result = await evaluate({
      domain: "amech.spf.test",
      ip: "198.51.100.31",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_NOT_AUTHORIZED);
  });

  it("applies the CIDR length when one is written", async () => {
    const result = await evaluate({
      domain: "aprefix.spf.test",
      ip: "198.51.100.31",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_AUTHORIZED);
  });

  it("asks for AAAA when the client is IPv6", async () => {
    const result = await evaluate({
      domain: "amech.spf.test",
      ip: "2001:db8:cafe::1",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_AUTHORIZED);
    expect(
      result.lookups.some((lookup) => lookup.name === "host.spf.test")
    ).toBe(true);
    expect(codes(result)).not.toContain(DiagnosisCode.SPF_VOID_LOOKUP);
  });
});

describe("the mx mechanism", () => {
  it("matches the address behind the exchange", async () => {
    const result = await evaluate({
      domain: "mxmatch.spf.test",
      ip: "198.51.100.40",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_AUTHORIZED);
  });

  it("spends only one of the ten on the whole mechanism", async () => {
    const result = await evaluate({
      domain: "mxmatch.spf.test",
      ip: "198.51.100.40",
    });

    expect(codes(result)).not.toContain(DiagnosisCode.SPF_LOOKUP_LIMIT_NEAR);
    expect(result.lookups.map((lookup) => lookup.name)).toEqual([
      "mxmatch.spf.test",
      "mail.spf.test",
      "mx1.spf.test",
    ]);
  });
});

describe("the exists mechanism", () => {
  it("matches on the name resolving, whatever it resolves to", async () => {
    const result = await evaluate({
      domain: "existsmech.spf.test",
      ip: "203.0.113.55",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_AUTHORIZED);
  });
});

describe("include borrows a pass and nothing else", () => {
  it("authorises a host the included record lists", async () => {
    const result = await evaluate({ domain: "spf.test", ip: "198.51.100.7" });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_AUTHORIZED);
    expect(
      evidenceFor(result, DiagnosisCode.SPF_IP_AUTHORIZED).detail
    ).toContain("include:one.spf.test");
  });

  it("does not let a nested -all reject the message", async () => {
    const result = await evaluate({ domain: "spf.test", ip: "192.0.2.1" });

    const { detail } = evidenceFor(result, DiagnosisCode.SPF_IP_NOT_AUTHORIZED);
    expect(detail).toContain("-all");
    expect(detail).toContain("spf.test");
    expect(detail).not.toContain("one.spf.test");
  });

  it("authorises through two levels of include", async () => {
    const result = await evaluate({ domain: "spf.test", ip: "203.0.113.7" });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_AUTHORIZED);
  });
});

describe("redirect", () => {
  it("takes the target's result, qualifier and all", async () => {
    const authorised = await evaluate({
      domain: "redirected.spf.test",
      ip: "198.51.100.7",
    });
    const rejected = await evaluate({
      domain: "redirected.spf.test",
      ip: "203.0.113.7",
    });

    expect(ipOutcome(authorised)).toBe(DiagnosisCode.SPF_IP_AUTHORIZED);
    expect(ipOutcome(rejected)).toBe(DiagnosisCode.SPF_IP_NOT_AUTHORIZED);
    expect(
      evidenceFor(rejected, DiagnosisCode.SPF_IP_NOT_AUTHORIZED).detail
    ).toContain("one.spf.test");
  });
});

describe("what cannot be decided from DNS", () => {
  it("does not guess at a ptr mechanism", async () => {
    const result = await evaluate({
      domain: "ptrmech.spf.test",
      ip: "198.51.100.7",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_UNDETERMINED);
    expect(codes(result)).not.toContain(DiagnosisCode.SPF_IP_NOT_AUTHORIZED);
  });

  it("does not attempt %{p}, which needs a reverse lookup", async () => {
    const result = await evaluate({
      domain: "macroptr.spf.test",
      ip: "198.51.100.7",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_UNDETERMINED);
  });

  it("does not guess at a macro whose input was not given", async () => {
    const result = await evaluate({
      domain: "macrosender.spf.test",
      ip: "198.51.100.7",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_UNDETERMINED);
    expect(codes(result)).toContain(DiagnosisCode.SPF_MACRO_NOT_EVALUATED);
  });

  it("says so when the address given is not an address", async () => {
    const result = await evaluate({
      domain: "one.spf.test",
      ip: "not-an-address",
    });

    expect(codes(result)).toContain(DiagnosisCode.SPF_IP_UNDETERMINED);
    expect(
      evidenceFor(result, DiagnosisCode.SPF_IP_UNDETERMINED).observed
    ).toBe("not-an-address");
  });
});

describe("the record audit still runs alongside", () => {
  it("reports the lookup limit even when the sender passes early", async () => {
    const result = await evaluate({
      domain: "near.spf.test",
      ip: "198.51.100.7",
    });

    expect(codes(result)).toContain(DiagnosisCode.SPF_LOOKUP_LIMIT_NEAR);
  });

  it("reports both an authorised sender and a dangerous record", async () => {
    const result = await evaluate({
      domain: "plusall.spf.test",
      ip: "203.0.113.7",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_AUTHORIZED);
    expect(codes(result)).toContain(DiagnosisCode.SPF_ALL_PASS);
    expect(result.verdict).toBe("fail");
  });

  it("answers both questions in one evaluation", async () => {
    const result = await evaluate({
      domain: "spf.test",
      include: "three.spf.test",
      ip: "198.51.100.7",
    });

    expect(codes(result)).toEqual([DiagnosisCode.SPF_IP_AUTHORIZED]);
    expect(result.verdict).toBe("pass");
  });
});

describe("no address given", () => {
  it("audits the record and reports no SPF_IP finding at all", async () => {
    const result = await evaluate({ domain: "one.spf.test" });

    expect(ipOutcome(result)).toBeUndefined();
    expect(result.verdict).toBe("pass");
  });
});
