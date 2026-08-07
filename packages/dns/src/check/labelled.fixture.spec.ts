import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import { nameAt } from "./profile";
import { runChecks } from "./run";

/**
 * `spf` and `mx` asked at a label, against the real tier.
 *
 * The case this exists for is the one every sending platform issues and no
 * single-name profile could express: `customer.test` declares a null MX because
 * it sends and does not receive, while `send.customer.test` declares a
 * deliverable one because bounces have to land somewhere. Opposite assertions,
 * both correct, about two names — so the interesting assertion is not that a
 * labelled check works but that the two coexist in one profile and are told
 * apart afterwards.
 */

const fixture = fixtureTarget("resolver");

const RESOLVER = {
  budgetMs: 10_000,
  maxLookups: 60,
  recursionDesired: true,
  target: { address: fixture.address, port: fixture.port },
  timeoutMs: 2000,
};

function run(profile: Parameters<typeof runChecks>[0]["profile"]) {
  return runChecks({ domain: "customer.test", profile, resolver: RESOLVER });
}

function outcome(result: Awaited<ReturnType<typeof run>>, kind: string) {
  return result.checks.find((check) => check.kind === kind);
}

describe("nameAt", () => {
  it("treats both spellings of no label as the apex", () => {
    // The empty string arrives from `RecordOutcome`, `undefined` from a profile
    // that omitted the field. A missed case appends a bare dot and queries a
    // name nobody published.
    expect(nameAt(undefined, "example.com")).toBe("example.com");
    expect(nameAt("", "example.com")).toBe("example.com");
    expect(nameAt("send", "example.com")).toBe("send.example.com");
  });
});

describe("a sending domain and its return-path host", () => {
  it("passes opposite MX assertions about two names in one profile", async () => {
    const result = await run({
      checks: ["mx"],
      id: "both",
      mx: [{ expectsMail: false }, { expectsMail: true, label: "send" }],
    });

    const mx = outcome(result, "mx");

    expect(mx?.verdict).toBe("pass");
    expect(mx?.records?.map((record) => record.label).sort()).toEqual([
      "",
      "send",
    ]);
    // The apex reports its null MX at info severity — correct configuration
    // that a dashboard should still say out loud — and the bounce host reports
    // nothing at all.
    expect(
      mx?.records
        ?.find((record) => record.label === "")
        ?.findings.map((finding) => finding.code)
    ).toContain(DiagnosisCode.MX_NULL);
    expect(
      mx?.records?.find((record) => record.label === "send")?.findings
    ).toHaveLength(0);
  });

  it("catches the assertion pointed at the wrong name", async () => {
    /**
     * The apex of a send-only domain has a null MX, so demanding deliverable
     * mail there is a fault — and it is precisely the mistake a profile written
     * without labels makes, because it has nowhere else to put the assertion.
     */
    const result = await run({
      checks: ["mx"],
      id: "swapped",
      mx: [{ expectsMail: true }, { expectsMail: false, label: "send" }],
    });

    expect(outcome(result, "mx")?.verdict).toBe("fail");
  });

  it("finds the include at the label and not at the apex", async () => {
    const result = await run({
      checks: ["spf"],
      id: "labelled",
      spf: [{ include: "one.spf.test", label: "send" }],
    });

    const spf = outcome(result, "spf");

    expect(spf?.verdict).toBe("pass");
    expect(spf?.records?.map((record) => record.label)).toEqual(["send"]);
    // Every lookup this check made was about the labelled name. A label that
    // silently fell back to the apex would pass this domain too, since the apex
    // publishes the same include — so the name is the assertion.
    expect(
      spf?.lookups.some((lookup) => lookup.name === "send.customer.test")
    ).toBe(true);
  });

  it("reports the labelled name, which is what a customer has to go and fix", async () => {
    const result = await run({
      checks: ["spf"],
      id: "missing",
      spf: [{ include: "one.spf.test", label: "nothing-here" }],
    });

    const spf = outcome(result, "spf");

    expect(spf?.verdict).toBe("fail");
    expect(
      spf?.findings.some(
        (finding) => finding.evidence.name === "nothing-here.customer.test"
      )
    ).toBe(true);
  });

  it("asks the apex when no label is given, as it always did", async () => {
    // The compatibility assertion. `checks: ["spf"]` with nothing configured is
    // the public checker's question, and it must stay a check that runs rather
    // than becoming a skipped one now that the field is a list.
    const result = await run({ checks: ["spf"], id: "bare" });

    const spf = outcome(result, "spf");

    expect(spf?.verdict).toBe("pass");
    expect(spf?.records?.map((record) => record.label)).toEqual([""]);
  });
});
