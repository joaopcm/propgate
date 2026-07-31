import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import type { ServerAddress } from "../types";
import { createEvaluationContext } from "./context";
import { evaluateDelegation, parentOf } from "./delegation";
import type { EvaluationResult, Evidence } from "./types";

/**
 * Delegation health against real servers.
 *
 * Nothing here can be checked from one server's answers, which is the point:
 * every finding is a disagreement between two servers, or a fact about one that
 * the others cannot report.
 */

const TIMEOUT_MS = 2000;

function target(role: Parameters<typeof fixtureTarget>[0]): ServerAddress {
  const fixture = fixtureTarget(role);
  return { address: fixture.address, port: fixture.port };
}

/**
 * Always through the recursive tier.
 *
 * Unlike the other evaluators, this one cannot talk straight to an
 * authoritative server: finding the parent's nameservers is itself a
 * resolution, and dns-auth is not authoritative for `test`.
 */
async function evaluate(domain: string): Promise<EvaluationResult> {
  const context = createEvaluationContext({
    recursionDesired: true,
    target: target("resolver"),
    timeoutMs: TIMEOUT_MS,
  });

  return await evaluateDelegation(context, { domain });
}

function codes(result: EvaluationResult): string[] {
  return result.findings.map((finding) => finding.code);
}

function evidenceFor(result: EvaluationResult, code: DiagnosisCode): Evidence {
  return (
    result.findings.find((finding) => finding.code === code)?.evidence ?? {}
  );
}

describe("parentOf", () => {
  it("strips one label, and stops at a top-level domain", () => {
    expect(parentOf("a.b.example.com")).toBe("b.example.com");
    expect(parentOf("example.com.")).toBe("com");
    expect(parentOf("com")).toBeNull();
  });
});

describe("a healthy delegation", () => {
  it("reports nothing at all", async () => {
    // Worth its own fixture: a checker that finds something wrong with every
    // domain is a checker nobody reads.
    const result = await evaluate("healthy.test");

    expect(codes(result)).toEqual([]);
    expect(result.verdict).toBe("pass");
  });

  it("asks each nameserver directly, and records which", async () => {
    const result = await evaluate("healthy.test");
    const probes = result.lookups.filter((lookup) =>
      lookup.purpose.startsWith("whether")
    );

    expect(probes.map((lookup) => lookup.server.address).sort()).toEqual([
      "127.0.0.3",
      "127.0.0.8",
    ]);
  });
});

describe("lame delegation", () => {
  it("names the server that is not authoritative", async () => {
    // ns-decoy is authoritative for decoy.test and nothing else, so it refuses
    // lame.test outright. A resolver that picks it gets SERVFAIL while every
    // other resolver is fine.
    const result = await evaluate("lame.test");

    expect(codes(result)).toContain(DiagnosisCode.NS_DELEGATION_LAME);
    expect(evidenceFor(result, DiagnosisCode.NS_DELEGATION_LAME).observed).toBe(
      "ns-decoy.test"
    );
    expect(result.verdict).toBe("fail");
  });

  it("does not confuse a refusal with an unreachable server", async () => {
    // The two need different fixes: one is a misconfigured server that is up,
    // the other is a server that is gone.
    const result = await evaluate("lame.test");

    expect(codes(result)).not.toContain(DiagnosisCode.NS_UNREACHABLE);
    expect(codes(result)).not.toContain(DiagnosisCode.NS_ALL_UNREACHABLE);
  });
});

describe("an unreachable nameserver", () => {
  it("is a warning while the others still answer", async () => {
    // stale.test is delegated to ns1 and to ns-dead, which has nothing
    // listening. The domain resolves fine today, which is exactly why nobody
    // notices until the remaining server goes too.
    const result = await evaluate("stale.test");

    expect(codes(result)).toContain(DiagnosisCode.NS_UNREACHABLE);
    expect(evidenceFor(result, DiagnosisCode.NS_UNREACHABLE).observed).toBe(
      "ns-dead.test"
    );
    expect(result.verdict).toBe("warn");
  });

  it("is not reported as lame", async () => {
    const result = await evaluate("stale.test");

    expect(codes(result)).not.toContain(DiagnosisCode.NS_DELEGATION_LAME);
  });
});

describe("serial drift", () => {
  it("reports two servers holding different versions of the zone", async () => {
    const result = await evaluate("drift.test");

    expect(codes(result)).toContain(DiagnosisCode.NS_SERIAL_MISMATCH);
    expect(result.verdict).toBe("warn");
  });

  it("says which server holds which serial", async () => {
    // Without the pairing the finding is unactionable: the fix is to look at
    // the server that is behind, and the report has to say which that is.
    const observed =
      evidenceFor(
        await evaluate("drift.test"),
        DiagnosisCode.NS_SERIAL_MISMATCH
      ).observed ?? "";

    expect(observed).toContain("ns1.test at 7");
    expect(observed).toContain("ns-divergent.test at 3");
  });

  it("does not call either server lame", async () => {
    // Both are authoritative. Being out of date is not the same as not serving
    // the zone, and the fixes are unrelated.
    const result = await evaluate("drift.test");

    expect(codes(result)).not.toContain(DiagnosisCode.NS_DELEGATION_LAME);
  });
});

describe("parent and child disagreeing", () => {
  it("reports a nameserver the zone claims and the parent does not", async () => {
    // mismatch.test lists ns1 and ns-decoy; the delegation is ns1 alone. The
    // operator believes they have two nameservers and has one.
    const result = await evaluate("mismatch.test");

    expect(codes(result)).toContain(DiagnosisCode.NS_PARENT_CHILD_MISMATCH);

    const evidence = evidenceFor(
      result,
      DiagnosisCode.NS_PARENT_CHILD_MISMATCH
    );
    expect(evidence.expected).toBe("ns1.test");
    expect(evidence.observed).toContain("ns-decoy.test");
    expect(evidence.detail).toContain("no resolver is sent there");
  });

  it("probes only the servers the parent delegates to", async () => {
    // Resolvers follow the delegation, so a lame server the zone lists but the
    // parent does not is not a fault anyone experiences.
    const result = await evaluate("mismatch.test");

    expect(codes(result)).not.toContain(DiagnosisCode.NS_DELEGATION_LAME);
  });
});

describe("a single nameserver", () => {
  it("is a warning even when everything works", async () => {
    // spf.test is delegated to ns1 alone and is otherwise perfectly healthy.
    const result = await evaluate("spf.test");

    expect(codes(result)).toEqual([DiagnosisCode.NS_SINGLE_NAMESERVER]);
    expect(result.verdict).toBe("warn");
  });
});

describe("uncertainty is not failure", () => {
  it("returns indeterminate when nothing can be reached", async () => {
    const context = createEvaluationContext({
      target: { address: "127.0.0.1", port: 1 },
      timeoutMs: 500,
    });

    const result = await evaluateDelegation(context, { domain: "spf.test" });

    // Never "no nameservers": not being able to look is not evidence of
    // absence, and reporting it as a missing delegation would page someone
    // over a network blip on our side.
    expect(result.verdict).toBe("indeterminate");
    expect(codes(result)).not.toContain(DiagnosisCode.NS_DELEGATION_LAME);
  });
});
