import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import type { ServerAddress } from "../types";
import { runChecksAcrossVantagePoints } from "./consensus";
import { sendingOnly } from "./profile";

/**
 * Two vantage points that disagree, against the real fixture tier.
 *
 * `split.test` is served by dns-auth and dns-divergent with different SPF
 * records, both of them in the delegation. Nobody is lying — one side simply has
 * not caught up — and that is the case this whole layer exists for: the highest
 * stakes property in the product is that one disagreeing vantage point can never
 * produce a failure on its own.
 *
 * The vantage points here are the two authoritative servers rather than two
 * recursive resolvers, because that is the only way to *choose* which answer you
 * get. Through a resolver the divergence is invisible: it picks one nameserver
 * and caches it, which is precisely why a customer sees "it works for me".
 */

const TIMEOUT_MS = 2000;

const NEEDS_A_VANTAGE_POINT = /at least one vantage point/;

function server(role: "auth" | "divergent"): ServerAddress {
  const fixture = fixtureTarget(role);

  return { address: fixture.address, port: fixture.port };
}

const AUTH = server("auth");
const DIVERGENT = server("divergent");

// Only SPF: it is the check whose answer differs, and the delegation check
// deliberately asks each nameserver itself so it agrees from either vantage.
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
    // The property the README calls non-negotiable. One resolver serving a stale
    // answer must not be able to fire `domain.failed` — `nextState` treats
    // `indeterminate` as no state change at all, so this is what stops a blip
    // from paging a customer's customer.
    const result = await run([AUTH, DIVERGENT]);

    expect(result.verdict).toBe("indeterminate");
    expect(result.verdict).not.toBe("fail");
  });

  it("says nothing about divergence when every vantage point agrees", async () => {
    // A checker that finds something on every domain is a checker nobody reads,
    // and this layer runs on every check. Asking the same server twice is the
    // cleanest available proof that agreement is silent.
    const result = await run([AUTH, AUTH]);

    expect(codes(result.findings)).not.toContain(
      DiagnosisCode.ANSWER_DIVERGES_BY_VANTAGE_POINT
    );
    expect(result.verdict).toBe("pass");
  });

  it("lets a majority outvote a single dissenting vantage point", async () => {
    // The reason for three rather than two. Two agreeing vantage points carry the
    // verdict instead of one broken resolver making the whole check uncertain.
    const result = await run([AUTH, AUTH, DIVERGENT]);

    expect(result.verdict).not.toBe("indeterminate");
    // Still reported, because a domain mid-propagation should be told so rather
    // than left to wonder why the answer keeps changing.
    expect(codes(result.findings)).toContain(
      DiagnosisCode.ANSWER_DIVERGES_BY_VANTAGE_POINT
    );
  });

  it("names which vantage point saw what", async () => {
    // A finding that says "these disagree" without saying how is not actionable.
    // The addresses are the whole content of this diagnosis.
    const result = await run([AUTH, DIVERGENT]);
    const finding = result.findings.find(
      (entry) => entry.code === DiagnosisCode.ANSWER_DIVERGES_BY_VANTAGE_POINT
    );

    expect(finding?.evidence.observed).toContain(AUTH.address);
    expect(finding?.evidence.observed).toContain(DIVERGENT.address);
  });

  it("keeps every vantage point's lookups, not just the winner's", async () => {
    // Results carry their derivation. When the answer is "we could not tell", the
    // losing vantage point's queries are the entire explanation.
    const single = await run([AUTH]);
    const both = await run([AUTH, DIVERGENT]);

    expect(both.lookups.length).toBeGreaterThan(single.lookups.length);
    expect(both.vantages).toHaveLength(2);
  });

  it("refuses to run with no vantage points at all", async () => {
    // A silent empty result would read as "nothing wrong". An agent can fix a
    // named error; it cannot fix an empty answer.
    await expect(run([])).rejects.toThrow(NEEDS_A_VANTAGE_POINT);
  });
});
