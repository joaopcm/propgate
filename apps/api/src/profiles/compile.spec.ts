import type { DomainExpectations, ProfileDefinition } from "@propgate/db";
import type { CheckResult, DomainProfile } from "@propgate/dns";
import { DiagnosisCode } from "@propgate/dns";
import { describe, expect, it } from "vitest";
import {
  attributeMissing,
  attributeResults,
  compileProfile,
  EXPECTATION_MISSING,
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

const PER_DOMAIN_KEY: ProfileDefinition = {
  requirements: [
    {
      check: "dkim",
      key: "dkim",
      requiredPerDomain: ["expectedPublicKey"],
      selector: "pg1",
    },
  ],
};

function runnable(
  definition: ProfileDefinition,
  expectations: DomainExpectations | null = null,
  id = "version-1"
): DomainProfile {
  const compiled = compileProfile(definition, id, expectations);

  if (compiled.kind !== "runnable") {
    throw new Error(
      `expected a runnable profile, got missing ${JSON.stringify(compiled.missing)}`
    );
  }

  return compiled.profile;
}

function fingerprint(
  definition: ProfileDefinition,
  expectations: DomainExpectations | null = null
): string {
  const compiled = compileProfile(definition, "version-1", expectations);

  if (compiled.kind !== "runnable") {
    throw new Error("expected a runnable profile");
  }

  return compiled.fingerprint;
}

const PER_LABEL: readonly string[] = ["spf", "mx", "ownership", "cname"];

function result(checks: CheckResult["checks"]): CheckResult {
  return {
    checks: checks.map((check) =>
      PER_LABEL.includes(check.kind) && check.records === undefined
        ? {
            ...check,
            records: [
              {
                findings: check.findings,
                label: "",
                lookups: check.lookups,
                verdict: check.verdict,
              },
            ],
          }
        : check
    ),
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
    ).toContain("only one spf requirement may sit at the apex");
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
    expect(
      rejectDefinition({ requirements: [{ check: "caa", key: "caa" }] })
    ).toContain("must name an issuer");
  });

  it("accepts a caa requirement whose issuer comes from the domain", () => {
    expect(
      rejectDefinition({
        requirements: [
          { check: "caa", key: "caa", requiredPerDomain: ["caaIssuer"] },
        ],
      })
    ).toBeNull();
  });

  it("accepts a dkim requirement whose selector comes from the domain", () => {
    expect(
      rejectDefinition({
        requirements: [
          { check: "dkim", key: "dkim", requiredPerDomain: ["selector"] },
        ],
      })
    ).toBeNull();
  });

  it("refuses a field that is both set here and required per domain", () => {
    expect(
      rejectDefinition({
        requirements: [
          {
            check: "dkim",
            expectedPublicKey: "MIIBIjANB",
            key: "dkim",
            requiredPerDomain: ["expectedPublicKey"],
            selector: "pg1",
          },
        ],
      })
    ).toContain("use one or the other");
  });

  it("refuses a per-domain field the check kind never looks at", () => {
    expect(
      rejectDefinition({
        requirements: [
          {
            check: "dkim",
            key: "dkim",
            requiredPerDomain: ["include"],
            selector: "pg1",
          },
        ],
      })
    ).toContain("expectedPublicKey or selector per domain");
  });

  it("names the check kind when it takes no per-domain fields at all", () => {
    expect(
      rejectDefinition({
        requirements: [
          { check: "dmarc", key: "dmarc", requiredPerDomain: ["include"] },
        ],
      })
    ).toContain("takes no per-domain fields");
  });

  it("refuses an ownership requirement with no token", () => {
    expect(
      rejectDefinition({ requirements: [{ check: "ownership", key: "own" }] })
    ).toContain("must name a token");
  });

  it("accepts an ownership requirement whose token comes from the domain", () => {
    expect(
      rejectDefinition({
        requirements: [
          {
            check: "ownership",
            key: "own",
            label: "_pg-challenge",
            requiredPerDomain: ["token"],
          },
        ],
      })
    ).toBeNull();
  });

  it("refuses a cname requirement missing either half", () => {
    expect(
      rejectDefinition({
        requirements: [{ check: "cname", key: "track", label: "track" }],
      })
    ).toContain("must name a target");

    expect(
      rejectDefinition({
        requirements: [
          { check: "cname", key: "track", target: "track.example.net" },
        ],
      })
    ).toContain("must name a label");
  });

  it("allows several ownership and cname requirements", () => {
    expect(
      rejectDefinition({
        requirements: [
          { check: "cname", key: "track", label: "track", target: "t.example" },
          {
            check: "cname",
            key: "bounce",
            label: "bounce",
            target: "b.example",
          },
          { check: "ownership", key: "apex", token: "one" },
          { check: "ownership", key: "labelled", label: "_pg", token: "two" },
        ],
      })
    ).toBeNull();
  });

  it("refuses two cname requirements at one label", () => {
    expect(
      rejectDefinition({
        requirements: [
          { check: "cname", key: "a", label: "track", target: "a.example" },
          { check: "cname", key: "b", label: "track", target: "b.example" },
        ],
      })
    ).toContain('duplicate cname label "track"');
  });

  it("refuses two ownership requirements at the apex", () => {
    expect(
      rejectDefinition({
        requirements: [
          { check: "ownership", key: "a", token: "one" },
          { check: "ownership", key: "b", token: "two" },
        ],
      })
    ).toContain("may sit at the apex");
  });
});

describe("compileProfile", () => {
  it("compiles an unlabelled profile to a single apex entry per kind", () => {
    expect(runnable(SENDING)).toEqual({
      checks: ["spf", "dkim", "dmarc", "mx"],
      dkimSelectors: ["pg1", "pg2"],
      id: "version-1",
      mx: [{ expectsMail: false }],
      spf: [{ include: "_spf.partner.example" }],
    });
  });

  it("asks for each check once, however many requirements named it", () => {
    expect(runnable(SENDING).checks).toEqual(["spf", "dkim", "dmarc", "mx"]);
  });

  it("carries every dkim selector through", () => {
    expect(runnable(SENDING).dkimSelectors).toEqual(["pg1", "pg2"]);
  });

  it("keeps an expected key attached to its selector", () => {
    expect(
      runnable({
        requirements: [
          {
            check: "dkim",
            expectedPublicKey: "MIIBIjANB",
            key: "dkim",
            selector: "pg1",
          },
        ],
      }).dkimSelectors
    ).toEqual([{ expectedPublicKey: "MIIBIjANB", selector: "pg1" }]);
  });

  it("identifies the profile by version, not by key", () => {
    expect(runnable(SENDING).id).toBe("version-1");
  });

  it("leaves expectsMail unstated when the tenant did not state it", () => {
    expect(
      "expectsMail" in
        runnable({ requirements: [{ check: "mx", key: "mail" }] })
    ).toBe(false);
  });

  it("passes a stated expectsMail of false through rather than dropping it", () => {
    expect(runnable(SENDING).mx).toEqual([{ expectsMail: false }]);
  });
});

describe("compileProfile with per-domain values", () => {
  it("attaches the domain's key to the profile's selector", () => {
    expect(
      runnable(PER_DOMAIN_KEY, {
        dkim: { expectedPublicKey: "MIIBIjANB" },
      }).dkimSelectors
    ).toEqual([{ expectedPublicKey: "MIIBIjANB", selector: "pg1" }]);
  });

  it("is incomplete, never runnable, when a required value is absent", () => {
    const compiled = compileProfile(PER_DOMAIN_KEY, "version-1", null);

    expect(compiled.kind).toBe("incomplete");
    expect(compiled.kind === "incomplete" && compiled.missing).toEqual([
      { field: "expectedPublicKey", requirementKey: "dkim" },
    ]);
  });

  it("treats a blank value as absent rather than as an expectation", () => {
    expect(
      compileProfile(PER_DOMAIN_KEY, "version-1", {
        dkim: { expectedPublicKey: "   " },
      }).kind
    ).toBe("incomplete");
  });

  it("names every missing value, not just the first", () => {
    const compiled = compileProfile(
      {
        requirements: [
          { check: "dkim", key: "d", requiredPerDomain: ["selector"] },
          { check: "caa", key: "c", requiredPerDomain: ["caaIssuer"] },
        ],
      },
      "version-1",
      null
    );

    expect(compiled.kind === "incomplete" && compiled.missing).toEqual([
      { field: "selector", requirementKey: "d" },
      { field: "caaIssuer", requirementKey: "c" },
    ]);
  });

  it("takes a deferred selector from the domain", () => {
    expect(
      runnable(
        {
          requirements: [
            { check: "dkim", key: "dkim", requiredPerDomain: ["selector"] },
          ],
        },
        { dkim: { selector: "acme-1" } }
      ).dkimSelectors
    ).toEqual(["acme-1"]);
  });

  it("takes a deferred include and issuer from the domain", () => {
    const compiled = runnable(
      {
        requirements: [
          { check: "spf", key: "spf", requiredPerDomain: ["include"] },
          { check: "caa", key: "caa", requiredPerDomain: ["caaIssuer"] },
        ],
      },
      {
        caa: { caaIssuer: "letsencrypt.org" },
        spf: { include: "send.acme.com" },
      }
    );

    expect(compiled.spf).toEqual([{ include: "send.acme.com" }]);
    expect(compiled.caaIssuer).toBe("letsencrypt.org");
  });

  it("ignores a value naming a requirement the profile does not have", () => {
    expect(
      runnable(SENDING, { nonesuch: { include: "evil.example" } })
    ).toEqual(runnable(SENDING));
  });

  it("ignores a value for a field the profile did not defer", () => {
    expect(runnable(SENDING, { spf: { include: "evil.example" } }).spf).toEqual(
      [{ include: "_spf.partner.example" }]
    );
  });

  it("does not let a stale value enable a check the profile dropped", () => {
    const compiled = runnable(
      { requirements: [{ check: "dmarc", key: "dmarc" }] },
      { caa: { caaIssuer: "letsencrypt.org" } }
    );

    expect(compiled.checks).toEqual(["dmarc"]);
    expect("caaIssuer" in compiled).toBe(false);
  });
});

describe("the expectations fingerprint", () => {
  it("is stable for the same inputs", () => {
    const values = { dkim: { expectedPublicKey: "MIIBIjANB" } };

    expect(fingerprint(PER_DOMAIN_KEY, values)).toBe(
      fingerprint(PER_DOMAIN_KEY, values)
    );
  });

  it("moves when a supplied value changes", () => {
    expect(
      fingerprint(PER_DOMAIN_KEY, { dkim: { expectedPublicKey: "one" } })
    ).not.toBe(
      fingerprint(PER_DOMAIN_KEY, { dkim: { expectedPublicKey: "two" } })
    );
  });

  it("moves when a profile literal changes with the values held constant", () => {
    const before: ProfileDefinition = {
      requirements: [{ check: "spf", include: "a.example", key: "spf" }],
    };
    const after: ProfileDefinition = {
      requirements: [{ check: "spf", include: "b.example", key: "spf" }],
    };

    expect(fingerprint(before)).not.toBe(fingerprint(after));
  });

  it("does not depend on the order keys were written in", () => {
    const definition: ProfileDefinition = {
      requirements: [
        { check: "spf", key: "spf", requiredPerDomain: ["include"] },
        { check: "caa", key: "caa", requiredPerDomain: ["caaIssuer"] },
      ],
    };

    expect(
      fingerprint(definition, {
        caa: { caaIssuer: "letsencrypt.org" },
        spf: { include: "send.acme.com" },
      })
    ).toBe(
      fingerprint(definition, {
        caa: { caaIssuer: "letsencrypt.org" },
        spf: { include: "send.acme.com" },
      })
    );
  });

  it("ignores values the profile did not ask for", () => {
    expect(fingerprint(SENDING, { nonesuch: { include: "x" } })).toBe(
      fingerprint(SENDING)
    );
  });
});

describe("attributeMissing", () => {
  it("reports every requirement as indeterminate, not just the incomplete one", () => {
    const attributed = attributeMissing(SENDING, [
      { field: "expectedPublicKey", requirementKey: "dkim-one" },
    ]);

    expect(attributed).toHaveLength(5);
    expect(attributed.every((entry) => entry.verdict === "indeterminate")).toBe(
      true
    );
    expect(attributed.every((entry) => entry.satisfied === false)).toBe(true);
  });

  it("gives the affected requirement the path to set", () => {
    const attributed = attributeMissing(PER_DOMAIN_KEY, [
      { field: "expectedPublicKey", requirementKey: "dkim" },
    ]);

    expect(attributed[0]?.findings).toEqual([
      {
        code: EXPECTATION_MISSING,
        expected: "expectations.dkim.expectedPublicKey",
      },
    ]);
  });

  it("leaves the unaffected requirements without a finding", () => {
    const attributed = attributeMissing(SENDING, [
      { field: "expectedPublicKey", requirementKey: "dkim-one" },
    ]);

    expect(attributed.find((entry) => entry.key === "spf")?.findings).toEqual(
      []
    );
  });

  it("folds to indeterminate overall, so nothing transitions", () => {
    expect(
      overallVerdict(
        attributeMissing(PER_DOMAIN_KEY, [
          { field: "expectedPublicKey", requirementKey: "dkim" },
        ])
      )
    ).toBe("indeterminate");
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
      ]),
      null
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

  it("files each alias against the requirement that named its label", () => {
    const definition: ProfileDefinition = {
      requirements: [
        { check: "cname", key: "track", label: "track", target: "t.example" },
        { check: "cname", key: "bounce", label: "bounce", target: "b.example" },
      ],
    };

    const attributed = attributeResults(
      definition,
      result([
        {
          findings: [],
          kind: "cname",
          lookups: [],
          records: [
            { findings: [], label: "track", lookups: [], verdict: "pass" },
            { findings: [], label: "bounce", lookups: [], verdict: "fail" },
          ],
          verdict: "fail",
        },
      ]),
      null
    );

    expect(attributed.find((r) => r.key === "track")).toMatchObject({
      satisfied: true,
      verdict: "pass",
    });
    expect(attributed.find((r) => r.key === "bounce")).toMatchObject({
      satisfied: false,
      verdict: "fail",
    });
  });

  it("matches an apex token against the empty label the resolver reports", () => {
    const attributed = attributeResults(
      { requirements: [{ check: "ownership", key: "own", token: "abc" }] },
      result([
        {
          findings: [],
          kind: "ownership",
          lookups: [],
          records: [{ findings: [], label: "", lookups: [], verdict: "pass" }],
          verdict: "pass",
        },
      ]),
      null
    );

    expect(attributed[0]).toMatchObject({ satisfied: true, verdict: "pass" });
  });

  it("matches a token whose label the domain supplied", () => {
    const definition: ProfileDefinition = {
      requirements: [
        {
          check: "ownership",
          key: "own",
          requiredPerDomain: ["label", "token"],
        },
      ],
    };

    const attributed = attributeResults(
      definition,
      result([
        {
          findings: [],
          kind: "ownership",
          lookups: [],
          records: [
            { findings: [], label: "_acme-42", lookups: [], verdict: "pass" },
          ],
          verdict: "pass",
        },
      ]),
      { own: { label: "_acme-42", token: "abc" } }
    );

    expect(attributed[0]).toMatchObject({ satisfied: true, verdict: "pass" });
  });

  it("refuses to guess when two requirements resolve to one label", () => {
    const definition: ProfileDefinition = {
      requirements: [
        { check: "ownership", key: "a", requiredPerDomain: ["label", "token"] },
        { check: "ownership", key: "b", requiredPerDomain: ["label", "token"] },
      ],
    };

    const attributed = attributeResults(
      definition,
      result([
        {
          findings: [],
          kind: "ownership",
          lookups: [],
          records: [
            { findings: [], label: "_pg", lookups: [], verdict: "pass" },
            { findings: [], label: "_pg", lookups: [], verdict: "fail" },
          ],
          verdict: "fail",
        },
      ]),
      { a: { label: "_pg", token: "T1" }, b: { label: "_pg", token: "T2" } }
    );

    for (const entry of attributed) {
      expect(entry).toMatchObject({
        satisfied: false,
        verdict: "indeterminate",
      });
    }
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
      ]),
      null
    );

    expect(attributed[0]).toMatchObject({ satisfied: true, verdict: "warn" });
  });

  it("counts indeterminate as neither met nor failed", () => {
    const attributed = attributeResults(
      { requirements: [{ check: "spf", key: "spf" }] },
      result([
        { findings: [], kind: "spf", lookups: [], verdict: "indeterminate" },
      ]),
      null
    );

    expect(attributed[0]).toMatchObject({
      satisfied: false,
      verdict: "indeterminate",
    });
  });

  it("is indeterminate, never passing, when a check produced no outcome", () => {
    const attributed = attributeResults(
      { requirements: [{ check: "spf", key: "spf" }] },
      result([]),
      null
    );

    expect(attributed[0]?.verdict).toBe("indeterminate");
  });

  it("keeps what was observed against what was expected", () => {
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
      ]),
      null
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
      ]),
      null
    );

    expect(attributed[0]?.findings[0]).toEqual({
      code: DiagnosisCode.DKIM_RECORD_MISSING,
      name: "pg1._domainkey.example.com",
    });
  });

  it("finds a deferred selector's outcome by the resolved name", () => {
    const attributed = attributeResults(
      {
        requirements: [
          { check: "dkim", key: "dkim", requiredPerDomain: ["selector"] },
        ],
      },
      result([
        {
          findings: [],
          kind: "dkim",
          lookups: [],
          selectors: [
            { findings: [], lookups: [], selector: "acme-1", verdict: "pass" },
          ],
          verdict: "pass",
        },
      ]),
      { dkim: { selector: "acme-1" } }
    );

    expect(attributed[0]).toMatchObject({ satisfied: true, verdict: "pass" });
  });

  it("is indeterminate when a deferred selector resolves to something else", () => {
    const attributed = attributeResults(
      {
        requirements: [
          { check: "dkim", key: "dkim", requiredPerDomain: ["selector"] },
        ],
      },
      result([
        {
          findings: [],
          kind: "dkim",
          lookups: [],
          selectors: [
            { findings: [], lookups: [], selector: "other", verdict: "pass" },
          ],
          verdict: "pass",
        },
      ]),
      { dkim: { selector: "acme-1" } }
    );

    expect(attributed[0]?.verdict).toBe("indeterminate");
  });

  it("reports one result per requirement, in the order they were written", () => {
    const attributed = attributeResults(SENDING, result([]), null);

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
