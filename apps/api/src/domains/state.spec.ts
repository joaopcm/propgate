import { DiagnosisCode } from "@propgate/dns";
import { describe, expect, it } from "vitest";
import type { RequirementResult } from "../profiles/compile";
import { observationFor } from "./state";

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
