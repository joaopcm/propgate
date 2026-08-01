import { DiagnosisCode } from "@propgate/dns";
import { describe, expect, it } from "vitest";
import type { RequirementResult } from "../profiles/compile";
import { nextState, observationFor } from "./state";

describe("nextState", () => {
  it("verifies a domain whose requirements are all met", () => {
    expect(nextState("pending", "pass")).toBe("verified");
  });

  it("verifies one that passes with advice", () => {
    // A warning describes something that works. p=none is a real DMARC record.
    expect(nextState("pending", "warn")).toBe("verified");
  });

  it("fails a domain with a requirement we watched break", () => {
    expect(nextState("verified", "fail")).toBe("failed");
  });

  it("leaves an indeterminate check exactly where it found things", () => {
    // The load-bearing edge that is not an edge. A resolver blip must not move
    // a verified domain to failed — in milestone 2 that is a webhook to a
    // partner's customer, sent because our upstream had a bad second.
    expect(nextState("verified", "indeterminate")).toBe("verified");
    expect(nextState("failed", "indeterminate")).toBe("failed");
    expect(nextState("pending", "indeterminate")).toBe("pending");
  });

  it("never reaches the two states this milestone cannot produce", () => {
    const reachable = (["pass", "warn", "fail", "indeterminate"] as const).map(
      (verdict) => nextState("pending", verdict)
    );

    expect(reachable).not.toContain("verifying");
    expect(reachable).not.toContain("degraded");
  });
});

describe("observationFor", () => {
  it("is the verdict alone when there is nothing to report", () => {
    expect(
      observationFor({
        findings: [],
        key: "spf",
        satisfied: true,
        verdict: "pass",
      })
    ).toBe("pass");
  });

  it("carries the codes that made it fail", () => {
    expect(
      observationFor({
        findings: [{ code: DiagnosisCode.DKIM_RECORD_MISSING }],
        key: "dkim",
        satisfied: false,
        verdict: "fail",
      })
    ).toBe("fail:DKIM_RECORD_MISSING");
  });

  it("does not change when the same findings arrive in a different order", () => {
    // A set of findings has no inherent order. Treating a reordering as a
    // change appends a timeline entry saying nothing happened.
    const findings: RequirementResult["findings"] = [
      { code: DiagnosisCode.DKIM_KEY_TOO_SHORT },
      { code: DiagnosisCode.DKIM_TESTING_MODE },
    ];

    expect(
      observationFor({ findings, key: "d", satisfied: false, verdict: "warn" })
    ).toBe(
      observationFor({
        findings: [...findings].reverse(),
        key: "d",
        satisfied: false,
        verdict: "warn",
      })
    );
  });

  it("ignores a record edit that changed nothing we assert", () => {
    // Comparing raw record text would append an entry every time a customer
    // reordered their SPF mechanisms. What is stored is the property that was
    // checked, not the string that satisfied it.
    const before = observationFor({
      findings: [],
      key: "spf",
      satisfied: true,
      verdict: "pass",
    });
    const after = observationFor({
      findings: [],
      key: "spf",
      satisfied: true,
      verdict: "pass",
    });

    expect(before).toBe(after);
  });

  it("changes when a requirement stops being met", () => {
    const met = observationFor({
      findings: [],
      key: "dkim",
      satisfied: true,
      verdict: "pass",
    });
    const gone = observationFor({
      findings: [{ code: DiagnosisCode.DKIM_RECORD_MISSING }],
      key: "dkim",
      satisfied: false,
      verdict: "fail",
    });

    expect(met).not.toBe(gone);
  });
});
