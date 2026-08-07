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

/** A profile that defers its DKIM key, which is the case the split exists for. */
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

/** Unwrap a compile that must be runnable, and fail loudly rather than cast. */
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

  it("accepts a caa requirement whose issuer comes from the domain", () => {
    /**
     * A deliberate change to what this function promises.
     *
     * The rule was "a requirement with no outcome to report against is a promise
     * the API cannot keep". Deferring the issuer keeps the promise somewhere else:
     * registration refuses a domain that does not supply one, so the requirement
     * is answerable for every domain that exists.
     */
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
    // Two answers and no rule for which wins. The type cannot express the
    // precedence, so the write is refused rather than resolved by convention.
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
    // A value the caller would supply forever and nothing would ever compare.
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
    // Nothing to compare against, so the requirement would read indeterminate
    // for the life of the profile. Worse than the DKIM case: an empty token
    // matches an empty TXT record, which is a false pass rather than a false
    // fail.
    expect(
      rejectDefinition({ requirements: [{ check: "ownership", key: "own" }] })
    ).toContain("must name a token");
  });

  it("accepts an ownership requirement whose token comes from the domain", () => {
    // The case the whole per-domain mechanism exists for. A token is minted for
    // one domain and means nothing on another, so a profile carrying one as a
    // literal is a profile with exactly one domain in it.
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
    // An absent label is the apex, which is a name like any other. Allowing both
    // would query one name twice and attribute one outcome to two requirements —
    // a correct answer to the wrong question, which is the failure this file's
    // header is about.
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
  it("compiles a profile that defers nothing exactly as it always did", () => {
    // The back-compat guard. Every profile written before per-domain values
    // existed must produce a byte-identical `DomainProfile` from a null domain.
    expect(runnable(SENDING)).toEqual({
      checks: ["spf", "dkim", "dmarc", "mx"],
      dkimSelectors: ["pg1", "pg2"],
      expectsMail: false,
      id: "version-1",
      spfInclude: "_spf.partner.example",
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
    // A result has to carry the exact definition it was produced against. That
    // is the entire reason a domain pins a version.
    expect(runnable(SENDING).id).toBe("version-1");
  });

  it("leaves expectsMail unstated when the tenant did not state it", () => {
    expect(
      "expectsMail" in
        runnable({ requirements: [{ check: "mx", key: "mail" }] })
    ).toBe(false);
  });

  it("passes a stated expectsMail of false through rather than dropping it", () => {
    // `false` is an assertion, not an absence. Dropping it reports every
    // sending-only domain as broken.
    expect(runnable(SENDING).expectsMail).toBe(false);
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
    /**
     * The regression test for the entire feature.
     *
     * Before the split, a missing `expectedPublicKey` collapsed into the bare
     * selector spelling — which asks "is *a* valid key published here" and
     * answers `pass`. "We never received the key" and "any key is acceptable"
     * were the same object, so forgetting a value shipped as a green domain.
     */
    const compiled = compileProfile(PER_DOMAIN_KEY, "version-1", null);

    expect(compiled.kind).toBe("incomplete");
    expect(compiled.kind === "incomplete" && compiled.missing).toEqual([
      { field: "expectedPublicKey", requirementKey: "dkim" },
    ]);
  });

  it("treats a blank value as absent rather than as an expectation", () => {
    // An empty expectation would be compared against every published value and
    // match none of them: a fail nobody can act on.
    expect(
      compileProfile(PER_DOMAIN_KEY, "version-1", {
        dkim: { expectedPublicKey: "   " },
      }).kind
    ).toBe("incomplete");
  });

  it("names every missing value, not just the first", () => {
    // An integrator fixing these one round trip at a time is an integrator we
    // made do the work our error message could have done once.
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

    expect(compiled.spfInclude).toBe("send.acme.com");
    expect(compiled.caaIssuer).toBe("letsencrypt.org");
  });

  it("ignores a value naming a requirement the profile does not have", () => {
    // The profile is the contract. Nothing a domain sends may widen it.
    expect(
      runnable(SENDING, { nonesuch: { include: "evil.example" } })
    ).toEqual(runnable(SENDING));
  });

  it("ignores a value for a field the profile did not defer", () => {
    // `spf` here carries a literal include. A domain overriding it would be
    // choosing what it is checked against, which is the tenant's decision.
    expect(
      runnable(SENDING, { spf: { include: "evil.example" } }).spfInclude
    ).toBe("_spf.partner.example");
  });

  it("does not let a stale value enable a check the profile dropped", () => {
    // What a re-point leaves behind. Retained, because pruning makes going back
    // lossy — but inert.
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
    /**
     * The re-point case, and why the digest is over the merged set.
     *
     * A domain pointed at a new profile version whose `include` differs is being
     * judged against something else, with nothing written to the domain row. A
     * timestamp on the domain would not notice; this does.
     */
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
    // Otherwise a stale key left behind by a re-point would keep changing the
    // digest of a check that never looked at it.
    expect(fingerprint(SENDING, { nonesuch: { include: "x" } })).toBe(
      fingerprint(SENDING)
    );
  });
});

describe("attributeMissing", () => {
  it("reports every requirement as indeterminate, not just the incomplete one", () => {
    // No check ran, so nothing is known about any of them. A `pass` here would
    // be reporting on a question nobody asked.
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
    // The reader is usually an agent. "EXPECTATION_MISSING" is not fixable;
    // a JSON path is.
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
    // Invariant 2 read backwards: a domain we could not judge must not move.
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
    /**
     * The two spellings of "no label" have to agree. `ownershipLabel` in
     * `@propgate/dns` reports an apex token as `""`; reading `requirement.label`
     * here would compare `undefined` against it, match nothing, and file a
     * passing check as indeterminate — leaving the domain unverifiable forever,
     * which is the exact failure the DKIM selector case documents.
     */
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
    // The distinction the whole stack preserves. A requirement we could not
    // evaluate must not read as a failure, or milestone 2 pages a customer over
    // a resolver blip.
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
      ]),
      null
    );

    expect(attributed[0]?.findings[0]).toEqual({
      code: DiagnosisCode.DKIM_RECORD_MISSING,
      name: "pg1._domainkey.example.com",
    });
  });

  it("finds a deferred selector's outcome by the resolved name", () => {
    /**
     * The requirement carries no selector; the domain supplies `acme-1`, so that
     * is the name the resolver reported an outcome under.
     *
     * Reading `requirement.selector` here compares `"acme-1" === undefined`,
     * matches nothing, and files a *passing* check as `indeterminate` — a domain
     * that can never reach `verified`, with nothing in the result explaining why.
     * Compilation and attribution are inverses, and this is the drift the header
     * of `compile.ts` warns about.
     */
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
    // The honest half of the rule above: matching by resolved name must still be
    // a match, not a wildcard that files whatever outcome happens to be first.
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
