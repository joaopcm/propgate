import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import type { ServerAddress } from "../types";
import { createEvaluationContext } from "./context";
import type { SpfCheck } from "./spf";
import { evaluateSpf } from "./spf";
import type { EvaluationResult, Evidence } from "./types";

/**
 * SPF against real servers.
 *
 * Everything interesting about SPF is a count spent across a tree of records,
 * so the fixtures are sized to land one term either side of each boundary. A
 * limit test that passes because the number happens to be large enough is not a
 * test of the limit.
 */

const TIMEOUT_MS = 2000;
const FILLER_TARGET = /^n\d+\./;

function target(role: Parameters<typeof fixtureTarget>[0]): ServerAddress {
  const fixture = fixtureTarget(role);
  return { address: fixture.address, port: fixture.port };
}

async function evaluate(
  check: SpfCheck,
  role: Parameters<typeof fixtureTarget>[0] = "auth"
): Promise<EvaluationResult> {
  const context = createEvaluationContext({
    // The whole include: tree can cost more than the default backstop leaves
    // room for once the limit fixtures are in play, and the backstop is not the
    // limit under test.
    maxLookups: 60,
    recursionDesired: role === "resolver" || role === "permissive",
    target: target(role),
    timeoutMs: TIMEOUT_MS,
  });

  return await evaluateSpf(context, check);
}

function codes(result: EvaluationResult): string[] {
  return result.findings.map((finding) => finding.code);
}

function evidenceFor(result: EvaluationResult, code: DiagnosisCode): Evidence {
  return (
    result.findings.find((finding) => finding.code === code)?.evidence ?? {}
  );
}

describe("a sound record", () => {
  it("passes with no findings at all", async () => {
    const result = await evaluate({ domain: "spf.test" });

    expect(codes(result)).toEqual([]);
    expect(result.verdict).toBe("pass");
  });

  it("walks the whole include tree, nearest first", async () => {
    const result = await evaluate({ domain: "spf.test" });

    // Four lookups recorded: the domain's own record, then one per include —
    // and three.spf.test is only reachable through two.spf.test.
    expect(result.lookups.map((lookup) => lookup.name)).toEqual([
      "spf.test",
      "one.spf.test",
      "two.spf.test",
      "three.spf.test",
    ]);
  });

  it("says why each lookup happened", async () => {
    const result = await evaluate({ domain: "spf.test" });

    expect(result.lookups[3]?.purpose).toContain("include:three.spf.test");
  });
});

describe("authorisation", () => {
  it("accepts a source listed at the apex", async () => {
    const result = await evaluate({
      domain: "spf.test",
      include: "one.spf.test",
    });

    expect(result.verdict).toBe("pass");
  });

  it("accepts a source reached through another include", async () => {
    // A platform a customer reaches through their own aggregator is authorised
    // just the same, so the check has to run against the expanded tree rather
    // than the terms written at the apex.
    const result = await evaluate({
      domain: "spf.test",
      include: "three.spf.test",
    });

    expect(result.verdict).toBe("pass");
  });

  it("fails when the source is absent, and names what is there", async () => {
    const result = await evaluate({
      domain: "spf.test",
      include: "_spf.notlisted.test",
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.SPF_SOURCE_NOT_AUTHORIZED);

    const evidence = evidenceFor(
      result,
      DiagnosisCode.SPF_SOURCE_NOT_AUTHORIZED
    );
    expect(evidence.observed).toContain("one.spf.test");
    // Where to put it matters: after `all` the term never runs.
    expect(evidence.detail).toContain("before the all mechanism");
  });
});

describe("the ten-lookup limit", () => {
  it("warns while the record is still legal", async () => {
    // Eight lookups. Nothing is broken yet, and that is the point: the next
    // sending service added is what breaks it, and by then the symptom is
    // failing mail rather than a record that looks wrong.
    const result = await evaluate({ domain: "near.spf.test" });

    expect(result.verdict).toBe("warn");
    expect(codes(result)).toEqual([DiagnosisCode.SPF_LOOKUP_LIMIT_NEAR]);
    expect(
      evidenceFor(result, DiagnosisCode.SPF_LOOKUP_LIMIT_NEAR).observed
    ).toBe("8 lookups");
  });

  it("fails on the eleventh, not the tenth", async () => {
    const result = await evaluate({ domain: "limit.spf.test" });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.SPF_LOOKUP_LIMIT_EXCEEDED);
    expect(
      evidenceFor(result, DiagnosisCode.SPF_LOOKUP_LIMIT_EXCEEDED).observed
    ).toContain("11 lookups");
  });

  it("never performs the lookup that would exceed the limit", async () => {
    // Ten queries, not eleven. The eleventh term is what fails the record, and
    // a conforming receiver knows that before sending it — so issuing it would
    // be work no receiver does, against a record already known to be broken.
    const result = await evaluate({ domain: "limit.spf.test" });

    expect(
      result.lookups.filter((lookup) => FILLER_TARGET.test(lookup.name))
    ).toHaveLength(10);
  });
});

describe("void lookups", () => {
  it("reports one, because it costs a lookup and authorises nothing", async () => {
    const result = await evaluate({ domain: "void1.spf.test" });

    expect(codes(result)).toEqual([DiagnosisCode.SPF_VOID_LOOKUP]);
    expect(result.verdict).toBe("warn");
  });

  it("fails on the third", async () => {
    const result = await evaluate({ domain: "void3.spf.test" });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(
      DiagnosisCode.SPF_VOID_LOOKUP_LIMIT_EXCEEDED
    );
  });
});

describe("temperror is not permerror", () => {
  it("returns indeterminate when an include SERVFAILs", async () => {
    // bogus-zone.test has deliberately broken signatures, so the validating
    // resolver answers SERVFAIL. Receivers defer on temperror rather than
    // reject, and this record may be entirely correct — reporting it as a
    // configuration error would send someone to edit something that is fine.
    const result = await evaluate({ domain: "temperror.spf.test" }, "resolver");

    expect(result.verdict).toBe("indeterminate");
    expect(codes(result)).toContain(DiagnosisCode.SPF_TEMPORARY_FAILURE);
    expect(codes(result)).not.toContain(DiagnosisCode.SPF_RECORD_MALFORMED);
    expect(codes(result)).not.toContain(DiagnosisCode.SPF_INCLUDE_UNRESOLVABLE);
  });

  it("names the domain that could not be reached", async () => {
    const result = await evaluate({ domain: "temperror.spf.test" }, "resolver");

    expect(evidenceFor(result, DiagnosisCode.SPF_TEMPORARY_FAILURE).name).toBe(
      "bogus-zone.test"
    );
  });

  it("resolves fine through the non-validating tier", async () => {
    // The same include, the same record: only the resolver differs. This is
    // what makes the finding above a property of validation rather than of the
    // SPF record.
    const result = await evaluate(
      { domain: "temperror.spf.test" },
      "permissive"
    );

    expect(codes(result)).not.toContain(DiagnosisCode.SPF_TEMPORARY_FAILURE);
  });

  it("is indeterminate, never a pass, when the server is unreachable", async () => {
    const context = createEvaluationContext({
      target: { address: "127.0.0.1", port: 1 },
      timeoutMs: 500,
    });

    const result = await evaluateSpf(context, { domain: "spf.test" });

    expect(result.verdict).toBe("indeterminate");
    expect(codes(result)).not.toContain(DiagnosisCode.SPF_RECORD_MISSING);
  });
});

describe("permanent errors", () => {
  it("treats two SPF records as authorising nothing", async () => {
    const result = await evaluate({ domain: "multi.spf.test" });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.SPF_MULTIPLE_RECORDS);
  });

  it("does not count an unrelated TXT record as a second SPF record", async () => {
    // Filtering on v=spf1 before counting. Without it, every domain that also
    // publishes a verification token is reported as broken.
    const result = await evaluate({ domain: "token.spf.test" });

    expect(codes(result)).not.toContain(DiagnosisCode.SPF_MULTIPLE_RECORDS);
    expect(result.verdict).toBe("pass");
  });

  it("reports a syntax error against the term that caused it", async () => {
    const result = await evaluate({ domain: "syntax.spf.test" });

    expect(result.verdict).toBe("fail");
    expect(
      evidenceFor(result, DiagnosisCode.SPF_RECORD_MALFORMED).detail
    ).toContain("198.51.100.999");
  });

  it("treats an include of a domain with no SPF record as permerror", async () => {
    // §5.2. Not "matched nothing, carry on" — the whole evaluation fails.
    const result = await evaluate({ domain: "unresolvable.spf.test" });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.SPF_INCLUDE_UNRESOLVABLE);
  });

  it("names the chain when an include loops", async () => {
    // The lookup limit would eventually stop this, but "too many lookups" is
    // not a sentence anyone can act on and "your chain loops" is.
    const result = await evaluate({ domain: "loop.spf.test" });

    expect(result.verdict).toBe("fail");
    expect(evidenceFor(result, DiagnosisCode.SPF_INCLUDE_LOOP).observed).toBe(
      "loop.spf.test -> loop.spf.test"
    );
  });

  it("rejects an mx expanding to more than ten names", async () => {
    const result = await evaluate({ domain: "mxmany.spf.test" });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.SPF_MX_LIMIT_EXCEEDED);
  });

  it("reports a missing record rather than staying silent", async () => {
    const result = await evaluate({ domain: "norecord.spf.test" });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toEqual([DiagnosisCode.SPF_RECORD_MISSING]);
  });
});

describe("what the record says about unlisted senders", () => {
  it("fails +all outright", async () => {
    const result = await evaluate({ domain: "plusall.spf.test" });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.SPF_ALL_PASS);
  });

  it("warns on ?all", async () => {
    const result = await evaluate({ domain: "neutral.spf.test" });

    expect(result.verdict).toBe("warn");
    expect(codes(result)).toContain(DiagnosisCode.SPF_ALL_NEUTRAL);
  });

  it("warns when there is no all and no redirect", async () => {
    const result = await evaluate({ domain: "noall.spf.test" });

    expect(result.verdict).toBe("warn");
    expect(codes(result)).toContain(DiagnosisCode.SPF_ALL_MISSING);
  });

  it("warns about ptr rather than rejecting it", async () => {
    const result = await evaluate({ domain: "ptrmech.spf.test" });

    expect(codes(result)).toContain(DiagnosisCode.SPF_PTR_MECHANISM);
    expect(codes(result)).not.toContain(DiagnosisCode.SPF_RECORD_MALFORMED);
  });
});

describe("terms that never run", () => {
  it("reports mechanisms written after all", async () => {
    const result = await evaluate({ domain: "afterall.spf.test" });

    expect(codes(result)).toContain(DiagnosisCode.SPF_TERMS_AFTER_ALL);
    expect(
      evidenceFor(result, DiagnosisCode.SPF_TERMS_AFTER_ALL).observed
    ).toBe("include:one.spf.test");
  });

  it("does not spend a lookup on them", async () => {
    // A receiver stops at `all`. Expanding past it would charge the record for
    // a lookup nobody makes, and could raise a temperror from a name that is
    // never queried in practice.
    const result = await evaluate({ domain: "afterall.spf.test" });

    expect(result.lookups.map((lookup) => lookup.name)).toEqual([
      "afterall.spf.test",
    ]);
  });

  it("reports a redirect that all makes unreachable", async () => {
    const result = await evaluate({ domain: "redirectignored.spf.test" });

    expect(codes(result)).toContain(DiagnosisCode.SPF_REDIRECT_IGNORED);
    expect(result.lookups).toHaveLength(1);
  });

  it("follows a redirect when there is no all", async () => {
    const result = await evaluate({
      domain: "redirected.spf.test",
      include: "one.spf.test",
    });

    expect(result.verdict).toBe("pass");
    expect(result.lookups.map((lookup) => lookup.name)).toEqual([
      "redirected.spf.test",
      "one.spf.test",
    ]);
  });
});

describe("macros", () => {
  it("says a term could not be evaluated rather than guessing", async () => {
    // exists:%{i}._spf... expands differently for every connection. Inventing a
    // client address would produce a pass or a void that the real evaluation
    // never sees.
    const result = await evaluate({ domain: "macro.spf.test" });

    expect(codes(result)).toContain(DiagnosisCode.SPF_MACRO_NOT_EVALUATED);
    expect(codes(result)).not.toContain(DiagnosisCode.SPF_VOID_LOOKUP);
  });

  it("still charges the term its lookup", async () => {
    // The receiver spends one whether or not we can expand the name.
    const result = await evaluate({ domain: "macro.spf.test" });

    expect(codes(result)).not.toContain(
      DiagnosisCode.SPF_LOOKUP_LIMIT_EXCEEDED
    );
    expect(result.verdict).toBe("pass");
  });
});
