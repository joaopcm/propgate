import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import { nameAt } from "./profile";
import { runChecks } from "./run";

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
    const result = await run({ checks: ["spf"], id: "bare" });

    const spf = outcome(result, "spf");

    expect(spf?.verdict).toBe("pass");
    expect(spf?.records?.map((record) => record.label)).toEqual([""]);
  });
});
