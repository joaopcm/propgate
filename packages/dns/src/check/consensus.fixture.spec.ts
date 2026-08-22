import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import type { ServerAddress } from "../types";
import { runChecksAcrossVantagePoints } from "./consensus";
import { sendingOnly } from "./profile";

const TIMEOUT_MS = 2000;

const NEEDS_A_VANTAGE_POINT = /at least one vantage point/;

function server(role: "auth" | "divergent"): ServerAddress {
  const fixture = fixtureTarget(role);

  return { address: fixture.address, port: fixture.port };
}

const AUTH = server("auth");
const DIVERGENT = server("divergent");

const PROFILE = sendingOnly({ spfInclude: "one.spf.test" });
const SPF_ONLY = { ...PROFILE, checks: ["spf"] as const };

function run(vantagePoints: readonly ServerAddress[]) {
  return runChecksAcrossVantagePoints({
    domain: "split.test",
    profile: SPF_ONLY,
    resolver: { maxLookups: 60, recursionDesired: true, timeoutMs: TIMEOUT_MS },
    vantagePoints,
  });
}

function codes(findings: readonly { code: string }[]): string[] {
  return findings.map((finding) => finding.code);
}

describe("runChecksAcrossVantagePoints", () => {
  it("reports divergence when two vantage points disagree", async () => {
    const result = await run([AUTH, DIVERGENT]);

    expect(codes(result.findings)).toContain(
      DiagnosisCode.ANSWER_DIVERGES_BY_VANTAGE_POINT
    );
  });

  it("calls a two-way disagreement indeterminate rather than failed", async () => {
    const result = await run([AUTH, DIVERGENT]);

    expect(result.verdict).toBe("indeterminate");
    expect(result.verdict).not.toBe("fail");
  });

  it("says nothing about divergence when every vantage point agrees", async () => {
    const result = await run([AUTH, AUTH]);

    expect(codes(result.findings)).not.toContain(
      DiagnosisCode.ANSWER_DIVERGES_BY_VANTAGE_POINT
    );
    expect(result.verdict).toBe("pass");
  });

  it("lets a majority outvote a single dissenting vantage point", async () => {
    const result = await run([AUTH, AUTH, DIVERGENT]);

    expect(result.verdict).not.toBe("indeterminate");
    expect(codes(result.findings)).toContain(
      DiagnosisCode.ANSWER_DIVERGES_BY_VANTAGE_POINT
    );
  });

  it("names which vantage point saw what", async () => {
    const result = await run([AUTH, DIVERGENT]);
    const finding = result.findings.find(
      (entry) => entry.code === DiagnosisCode.ANSWER_DIVERGES_BY_VANTAGE_POINT
    );

    expect(finding?.evidence.observed).toContain(AUTH.address);
    expect(finding?.evidence.observed).toContain(DIVERGENT.address);
  });

  it("keeps every vantage point's lookups, not just the winner's", async () => {
    const single = await run([AUTH]);
    const both = await run([AUTH, DIVERGENT]);

    expect(both.lookups.length).toBeGreaterThan(single.lookups.length);
    expect(both.vantages).toHaveLength(2);
  });

  it("refuses to run with no vantage points at all", async () => {
    await expect(run([])).rejects.toThrow(NEEDS_A_VANTAGE_POINT);
  });
});
