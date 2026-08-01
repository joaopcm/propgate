import { describe, expect, it } from "vitest";
import {
  byUrgency,
  type CheckOutcome,
  type CheckResult,
  docsUrlFor,
  type Finding,
  rankOf,
  recordTypeName,
  summarise,
} from "./check";

/** The pure parts of the client. The rendering is not worth a snapshot. */

function outcome(
  kind: CheckOutcome["kind"],
  verdict: CheckOutcome["verdict"]
): CheckOutcome {
  return { findings: [], kind, lookups: [], verdict };
}

function finding(severity: Finding["severity"]): Finding {
  return {
    code: "SPF_RECORD_MISSING",
    evidence: {},
    severity,
    slug: "spf-record-missing",
    summary: "…",
  };
}

function result(findings: Finding[], verdict: CheckResult["verdict"]) {
  return {
    checks: [],
    domain: "example.com",
    elapsedMs: 12,
    findings,
    verdict,
  };
}

describe("verdict ranking", () => {
  it("puts indeterminate above warn and below fail", () => {
    // The same ordering the resolver uses. "We could not tell" is more serious
    // than a warning because the check did not run, and less serious than a
    // failure that was actually observed.
    expect(rankOf("pass")).toBeLessThan(rankOf("warn"));
    expect(rankOf("warn")).toBeLessThan(rankOf("indeterminate"));
    expect(rankOf("indeterminate")).toBeLessThan(rankOf("fail"));
  });

  it("sorts the worst check to the top", () => {
    const sorted = [
      outcome("spf", "pass"),
      outcome("mx", "warn"),
      outcome("dkim", "fail"),
      outcome("dmarc", "indeterminate"),
    ]
      .sort(byUrgency)
      .map((entry) => entry.kind);

    expect(sorted).toEqual(["dkim", "dmarc", "mx", "spf"]);
  });
});

describe("summarise", () => {
  it("counts what there is to fix, and what is only worth reading", () => {
    expect(summarise(result([finding("error")], "fail"))).toBe(
      "1 problem to fix"
    );
    expect(
      summarise(result([finding("error"), finding("warning")], "fail"))
    ).toBe("1 problem to fix, 1 to look at");
    expect(summarise(result([finding("warning")], "warn"))).toBe(
      "1 thing worth looking at"
    );
  });

  it("does not count info findings as problems", () => {
    // MX_NULL is reported on a correctly configured sending-only domain. If it
    // counted, every healthy customer would be told they have something wrong.
    expect(summarise(result([finding("info")], "pass"))).toBe("nothing to fix");
  });

  it("says so when a check could not be completed", () => {
    expect(summarise(result([], "indeterminate"))).toContain("could not");
  });
});

describe("recordTypeName", () => {
  it("names the types the evaluators ask for", () => {
    expect(recordTypeName(16)).toBe("TXT");
    expect(recordTypeName(257)).toBe("CAA");
  });

  it("falls back to the number rather than inventing a name", () => {
    expect(recordTypeName(99)).toBe("99");
  });
});

const TAXONOMY_PATH = /\/taxonomy\/spf-record-missing$/;

describe("docsUrlFor", () => {
  it("addresses a finding's own page by its slug", () => {
    // The API sends a slug on every finding so a consumer can link here without
    // shipping a copy of the taxonomy. This is that link.
    expect(docsUrlFor("spf-record-missing")).toMatch(TAXONOMY_PATH);
  });
});
