import type { ProfileDefinition } from "@propgate/db";
import type { CheckResult } from "@propgate/dns";
import { DiagnosisCode } from "@propgate/dns";
import { describe, expect, it } from "vitest";
import {
  attributeResults,
  compileProfile,
  overallVerdict,
  rejectDefinition,
} from "./compile";

const SENDING: ProfileDefinition = {
  requirements: [
    { check: "spf", include: "_spf.partner.example", key: "spf" },
    { check: "dkim", key: "dkim-one", selector: "pg1" },
    { check: "dkim", key: "dkim-two", selector: "pg2" },
    { check: "dmarc", key: "dmarc" },
    { check: "mx", expectsMail: false, key: "mail" },
  ],
};

function result(checks: CheckResult["checks"]): CheckResult {
  return {
    checks,
    domain: "example.com",
    findings: checks.flatMap((check) => check.findings),
    lookups: [],
    profile: "v1",
    verdict: "pass",
  };
}

describe("rejectDefinition", () => {
  it("accepts a profile the evaluators can actually answer", () => {
    expect(rejectDefinition(SENDING)).toBeNull();
  });

  it("refuses a profile with nothing in it", () => {
    expect(rejectDefinition({ requirements: [] })).toContain(
      "at least one requirement"
    );
  });

  it("refuses two requirements sharing a key", () => {
    // The key is how a result is filed. Two requirements with one key means one
    // of them is unreportable for the life of the profile.
    expect(
      rejectDefinition({
        requirements: [
          { check: "spf", key: "same" },
          { check: "dmarc", key: "same" },
        ],
      })
    ).toContain('duplicate requirement key "same"');
  });

  it("refuses two requirements competing for one outcome", () => {
    expect(
      rejectDefinition({
        requirements: [
          { check: "spf", include: "a.example", key: "spf-a" },
          { check: "spf", include: "b.example", key: "spf-b" },
        ],
      })
    ).toContain("only one requirement may check spf");
  });

  it("allows several dkim requirements, which is the whole point", () => {
    expect(
      rejectDefinition({
        requirements: [
          { check: "dkim", key: "one", selector: "pg1" },
          { check: "dkim", key: "two", selector: "pg2" },
        ],
      })
    ).toBeNull();
  });

  it("refuses two dkim requirements naming one selector", () => {
    expect(
      rejectDefinition({
        requirements: [
          { check: "dkim", key: "one", selector: "pg1" },
          { check: "dkim", key: "two", selector: "pg1" },
        ],
      })
    ).toContain('duplicate dkim selector "pg1"');
  });

  it("refuses a dkim requirement with no selector", () => {
    expect(
      rejectDefinition({ requirements: [{ check: "dkim", key: "dkim" }] })
    ).toContain("must name a selector");
  });

  it("refuses a caa requirement with no issuer", () => {
    // The evaluator skips CAA without an issuer, so this would be a requirement
    // with no outcome to report against, forever.
    expect(
      rejectDefinition({ requirements: [{ check: "caa", key: "caa" }] })
    ).toContain("must name an issuer");
  });
});

describe("compileProfile", () => {
  it("asks for each check once, however many requirements named it", () => {
    const compiled = compileProfile(SENDING, "version-1");

    expect(compiled.checks).toEqual(["spf", "dkim", "dmarc", "mx"]);
  });

  it("carries every dkim selector through", () => {
    expect(compileProfile(SENDING, "version-1").dkimSelectors).toEqual([
      "pg1",
      "pg2",
    ]);
  });

  it("keeps an expected key attached to its selector", () => {
    const compiled = compileProfile(
      {
        requirements: [
          {
            check: "dkim",
            expectedPublicKey: "MIIBIjANB",
            key: "dkim",
            selector: "pg1",
          },
        ],
      },
      "version-1"
    );

    expect(compiled.dkimSelectors).toEqual([
      { expectedPublicKey: "MIIBIjANB", selector: "pg1" },
    ]);
  });

  it("identifies the profile by version, not by key", () => {
    // A result has to carry the exact definition it was produced against. That
    // is the entire reason a domain pins a version.
    expect(compileProfile(SENDING, "version-1").id).toBe("version-1");
  });

  it("leaves expectsMail unstated when the tenant did not state it", () => {
    const compiled = compileProfile(
      { requirements: [{ check: "mx", key: "mail" }] },
      "version-1"
    );

    expect("expectsMail" in compiled).toBe(false);
  });

  it("passes a stated expectsMail of false through rather than dropping it", () => {
    // `false` is an assertion, not an absence. Dropping it reports every
    // sending-only domain as broken.
    expect(compileProfile(SENDING, "version-1").expectsMail).toBe(false);
  });
});

describe("attributeResults", () => {
  it("files each dkim selector against its own requirement", () => {
    const attributed = attributeResults(
      SENDING,
      result([
        {
          findings: [],
          kind: "dkim",
          lookups: [],
          selectors: [
            { findings: [], lookups: [], selector: "pg1", verdict: "pass" },
            {
              findings: [
                {
                  code: DiagnosisCode.DKIM_RECORD_MISSING,
                  evidence: { name: "pg2._domainkey.example.com" },
                  severity: "error",
                },
              ],
              lookups: [],
              selector: "pg2",
              verdict: "fail",
            },
          ],
          verdict: "fail",
        },
      ])
    );

    expect(attributed.find((r) => r.key === "dkim-one")).toMatchObject({
      satisfied: true,
      verdict: "pass",
    });
    expect(attributed.find((r) => r.key === "dkim-two")).toMatchObject({
      satisfied: false,
      verdict: "fail",
    });
  });

  it("counts a warning as met, because it describes something that works", () => {
    const attributed = attributeResults(
      { requirements: [{ check: "dmarc", key: "dmarc" }] },
      result([
        {
          findings: [
            {
              code: DiagnosisCode.DMARC_POLICY_NONE,
              evidence: { observed: "p=none" },
              severity: "warning",
            },
          ],
          kind: "dmarc",
          lookups: [],
          verdict: "warn",
        },
      ])
    );

    expect(attributed[0]).toMatchObject({ satisfied: true, verdict: "warn" });
  });

  it("counts indeterminate as neither met nor failed", () => {
    // The distinction the whole stack preserves. A requirement we could not
    // evaluate must not read as a failure, or milestone 2 pages a customer over
    // a resolver blip.
    const attributed = attributeResults(
      { requirements: [{ check: "spf", key: "spf" }] },
      result([
        { findings: [], kind: "spf", lookups: [], verdict: "indeterminate" },
      ])
    );

    expect(attributed[0]).toMatchObject({
      satisfied: false,
      verdict: "indeterminate",
    });
  });

  it("is indeterminate, never passing, when a check produced no outcome", () => {
    const attributed = attributeResults(
      { requirements: [{ check: "spf", key: "spf" }] },
      result([])
    );

    expect(attributed[0]?.verdict).toBe("indeterminate");
  });

  it("keeps what was observed against what was expected", () => {
    // "What is wrong or missing", without an instruction renderer.
    const attributed = attributeResults(
      { requirements: [{ check: "spf", include: "a.example", key: "spf" }] },
      result([
        {
          findings: [
            {
              code: DiagnosisCode.SPF_SOURCE_NOT_AUTHORIZED,
              evidence: { expected: "a.example", observed: "v=spf1 -all" },
              severity: "error",
            },
          ],
          kind: "spf",
          lookups: [],
          verdict: "fail",
        },
      ])
    );

    expect(attributed[0]?.findings).toEqual([
      {
        code: DiagnosisCode.SPF_SOURCE_NOT_AUTHORIZED,
        expected: "a.example",
        observed: "v=spf1 -all",
      },
    ]);
  });

  it("carries the DNS name a missing record should have been at", () => {
    // The most actionable part of an absence. Without it a partner can tell
    // their customer something is missing but not where it goes.
    const attributed = attributeResults(
      { requirements: [{ check: "dkim", key: "dkim", selector: "pg1" }] },
      result([
        {
          findings: [],
          kind: "dkim",
          lookups: [],
          selectors: [
            {
              findings: [
                {
                  code: DiagnosisCode.DKIM_RECORD_MISSING,
                  evidence: { name: "pg1._domainkey.example.com" },
                  severity: "error",
                },
              ],
              lookups: [],
              selector: "pg1",
              verdict: "fail",
            },
          ],
          verdict: "fail",
        },
      ])
    );

    expect(attributed[0]?.findings[0]).toEqual({
      code: DiagnosisCode.DKIM_RECORD_MISSING,
      name: "pg1._domainkey.example.com",
    });
  });

  it("reports one result per requirement, in the order they were written", () => {
    const attributed = attributeResults(SENDING, result([]));

    expect(attributed.map((entry) => entry.key)).toEqual([
      "spf",
      "dkim-one",
      "dkim-two",
      "dmarc",
      "mail",
    ]);
  });
});

describe("overallVerdict", () => {
  it("prefers a failure it observed over uncertainty about the rest", () => {
    expect(
      overallVerdict([
        { findings: [], key: "a", satisfied: false, verdict: "indeterminate" },
        { findings: [], key: "b", satisfied: false, verdict: "fail" },
      ])
    ).toBe("fail");
  });

  it("is uncertain when one requirement could not be evaluated", () => {
    expect(
      overallVerdict([
        { findings: [], key: "a", satisfied: true, verdict: "pass" },
        { findings: [], key: "b", satisfied: false, verdict: "indeterminate" },
      ])
    ).toBe("indeterminate");
  });
});
