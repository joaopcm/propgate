import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import type { ServerAddress } from "../types";
import type { CaaCheck } from "./caa";
import { caaClimbPath, evaluateCaa } from "./caa";
import { createEvaluationContext } from "./context";
import type { EvaluationResult } from "./types";

const TIMEOUT_MS = 2000;

function target(role: Parameters<typeof fixtureTarget>[0]): ServerAddress {
  const fixture = fixtureTarget(role);
  return { address: fixture.address, port: fixture.port };
}

async function evaluate(
  check: CaaCheck,
  role: Parameters<typeof fixtureTarget>[0] = "auth"
): Promise<EvaluationResult> {
  const context = createEvaluationContext({
    recursionDesired: role === "resolver" || role === "permissive",
    target: target(role),
    timeoutMs: TIMEOUT_MS,
  });

  return await evaluateCaa(context, check);
}

function codes(result: EvaluationResult): string[] {
  return result.findings.map((finding) => finding.code);
}

describe("caaClimbPath", () => {
  it("stops before the root, per RFC 8659 §3", () => {
    expect(caaClimbPath("a.b.example.com")).toEqual([
      "a.b.example.com",
      "b.example.com",
      "example.com",
      "com",
    ]);
  });

  it("tolerates a trailing dot", () => {
    expect(caaClimbPath("example.com.")).toEqual(["example.com", "com"]);
  });
});

describe("the climb", () => {
  it("uses the domain's own policy without climbing", async () => {
    const result = await evaluate({
      domain: "caa.test",
      issuer: "letsencrypt.org",
    });

    expect(result.verdict).toBe("pass");
    expect(codes(result)).not.toContain(DiagnosisCode.CAA_POLICY_FROM_ANCESTOR);
    expect(result.lookups).toHaveLength(1);
  });

  it("climbs more than one label to find a policy", async () => {
    const result = await evaluate({
      domain: "deep.nested.caa.test",
      issuer: "letsencrypt.org",
    });

    expect(result.verdict).toBe("pass");
    expect(codes(result)).toContain(DiagnosisCode.CAA_POLICY_FROM_ANCESTOR);

    expect(result.lookups.map((lookup) => lookup.name)).toEqual([
      "deep.nested.caa.test",
      "nested.caa.test",
      "caa.test",
    ]);
  });

  it("says where the governing policy actually lives", async () => {
    const result = await evaluate({
      domain: "deep.nested.caa.test",
      issuer: "letsencrypt.org",
    });

    const finding = result.findings.find(
      (f) => f.code === DiagnosisCode.CAA_POLICY_FROM_ANCESTOR
    );
    expect(finding?.evidence.observed).toBe("caa.test");
  });

  it("crosses a zone cut rather than stopping at the delegation", async () => {
    const result = await evaluate({
      domain: "www.inner.caa-child.test",
      issuer: "parent-ca.test",
    });

    expect(result.verdict).toBe("pass");
    const finding = result.findings.find(
      (f) => f.code === DiagnosisCode.CAA_POLICY_FROM_ANCESTOR
    );
    expect(finding?.evidence.observed).toBe("caa-child.test");
  });

  it("reports no restriction when nothing is published up the tree", async () => {
    const result = await evaluate(
      { domain: "nodata.test", issuer: "letsencrypt.org" },
      "resolver"
    );

    expect(result.verdict).toBe("pass");
    expect(codes(result)).toEqual([DiagnosisCode.CAA_UNRESTRICTED]);
  });

  it("does not read a refusal as an absence of policy", async () => {
    const result = await evaluate({
      domain: "nodata.test",
      issuer: "letsencrypt.org",
    });

    expect(result.verdict).toBe("indeterminate");
    expect(codes(result)).not.toContain(DiagnosisCode.CAA_UNRESTRICTED);
  });
});

describe("the nearest ancestor wins outright", () => {
  it("does not merge a nearer policy with the apex's", async () => {
    const allowed = await evaluate({
      domain: "host.sub.caa.test",
      issuer: "digicert.com",
    });
    const blocked = await evaluate({
      domain: "host.sub.caa.test",
      issuer: "letsencrypt.org",
    });

    expect(allowed.verdict).toBe("pass");
    expect(blocked.verdict).toBe("fail");
    expect(codes(blocked)).toContain(DiagnosisCode.CAA_ISSUER_NOT_AUTHORIZED);
  });

  it("names the CAs that are permitted", async () => {
    const result = await evaluate({
      domain: "host.sub.caa.test",
      issuer: "letsencrypt.org",
    });

    const finding = result.findings.find(
      (f) => f.code === DiagnosisCode.CAA_ISSUER_NOT_AUTHORIZED
    );
    expect(finding?.evidence.observed).toBe("digicert.com");
    expect(finding?.evidence.expected).toBe("letsencrypt.org");
    expect(finding?.evidence.detail).toContain("rather than replacing");
  });

  it("accepts any of several listed CAs", async () => {
    const issuers = ["letsencrypt.org", "digicert.com"];
    const results = await Promise.all(
      issuers.map((issuer) => evaluate({ domain: "multi.caa.test", issuer }))
    );

    for (const [index, result] of results.entries()) {
      expect(result.verdict, issuers[index]).toBe("pass");
    }
  });
});

describe("deny-all", () => {
  it("blocks every authority", async () => {
    const result = await evaluate({
      domain: "denyall.caa.test",
      issuer: "letsencrypt.org",
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.CAA_ISSUANCE_DENIED);
  });

  it("survived the zone-file semicolon trap", async () => {
    const result = await evaluate({
      domain: "denyall.caa.test",
      issuer: "letsencrypt.org",
    });

    const finding = result.findings.find(
      (f) => f.code === DiagnosisCode.CAA_ISSUANCE_DENIED
    );
    expect(finding?.evidence.observed).toBe('issue ";"');
  });
});

describe("wildcards", () => {
  it("blocks a wildcard while ordinary certificates still work", async () => {
    const ordinary = await evaluate({
      domain: "caa.test",
      issuer: "letsencrypt.org",
    });
    const wildcard = await evaluate({
      domain: "caa.test",
      issuer: "letsencrypt.org",
      wildcard: true,
    });

    expect(ordinary.verdict).toBe("pass");
    expect(wildcard.verdict).toBe("fail");
    expect(codes(wildcard)).toContain(DiagnosisCode.CAA_WILDCARD_DENIED);
    expect(codes(wildcard)).not.toContain(DiagnosisCode.CAA_ISSUANCE_DENIED);
  });

  it("uses issuewild for wildcards and issue for the rest", async () => {
    const wildcardOk = await evaluate({
      domain: "split.caa.test",
      issuer: "digicert.com",
      wildcard: true,
    });
    const wildcardBlocked = await evaluate({
      domain: "split.caa.test",
      issuer: "letsencrypt.org",
      wildcard: true,
    });
    const ordinaryOk = await evaluate({
      domain: "split.caa.test",
      issuer: "letsencrypt.org",
    });

    expect(wildcardOk.verdict).toBe("pass");
    expect(wildcardBlocked.verdict).toBe("fail");
    expect(ordinaryOk.verdict).toBe("pass");
  });
});

describe("critical properties", () => {
  it("blocks issuance despite the policy also naming our CA", async () => {
    const result = await evaluate({
      domain: "critical.caa.test",
      issuer: "letsencrypt.org",
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(
      DiagnosisCode.CAA_CRITICAL_UNKNOWN_PROPERTY
    );
    expect(
      result.findings.find(
        (f) => f.code === DiagnosisCode.CAA_CRITICAL_UNKNOWN_PROPERTY
      )?.evidence.observed
    ).toBe("unknownprop");
  });
});

describe("account binding parameters", () => {
  it("does not mistake parameters for part of the CA name", async () => {
    const result = await evaluate({
      domain: "params.caa.test",
      issuer: "letsencrypt.org",
    });

    expect(result.verdict).toBe("pass");
  });
});

describe("uncertainty is not failure", () => {
  it("returns indeterminate when the server is unreachable", async () => {
    const context = createEvaluationContext({
      target: { address: "127.0.0.1", port: 1 },
      timeoutMs: 500,
    });

    const result = await evaluateCaa(context, {
      domain: "caa.test",
      issuer: "letsencrypt.org",
    });

    expect(result.verdict).toBe("indeterminate");
    expect(codes(result)).not.toContain(DiagnosisCode.CAA_UNRESTRICTED);
  });
});
