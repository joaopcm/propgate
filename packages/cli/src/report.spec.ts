import type { CheckResult, Finding, Verdict } from "@propgate/dns";
import { describe, expect, it } from "vitest";
import {
  EXIT_OK,
  EXIT_PROBLEM,
  EXIT_UNKNOWN,
  exitCodeFor,
  render,
} from "./report";

/**
 * Output and exit codes are pure, and are where a CLI is usually least tested
 * and most often wrong. Colour is off throughout so the assertions read.
 */

const style = { colour: false };
/** Two spaces, then the two-column mark, then the check name. */
const CHECK_LINE = /^ {2}\S|^ {3}\S/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the escape is the assertion
const ESCAPE = /\u001B\[/;

function finding(
  code: string,
  severity: Finding["severity"],
  evidence: Finding["evidence"] = {}
): Finding {
  return { code, evidence, severity } as Finding;
}

function result(
  verdict: Verdict,
  checks: Array<{
    findings?: Finding[];
    kind: string;
    verdict: Verdict;
  }>
): CheckResult {
  const built = checks.map((check) => ({
    findings: check.findings ?? [],
    kind: check.kind,
    lookups: [],
    verdict: check.verdict,
  }));

  return {
    checks: built,
    domain: "example.com",
    findings: built.flatMap((check) => check.findings),
    lookups: [],
    profile: "cli",
    verdict,
  } as unknown as CheckResult;
}

describe("exit codes", () => {
  it("is zero when there is nothing to fix", () => {
    expect(exitCodeFor(result("pass", []))).toBe(EXIT_OK);
  });

  it("is zero for warnings, which are not failures", () => {
    // A CI job should not go red because a domain has one nameserver.
    const warned = result("warn", [
      {
        findings: [finding("NS_SINGLE_NAMESERVER", "warning")],
        kind: "delegation",
        verdict: "warn",
      },
    ]);

    expect(exitCodeFor(warned)).toBe(EXIT_OK);
  });

  it("is one when something is actually wrong", () => {
    const failed = result("fail", [
      {
        findings: [finding("SPF_RECORD_MISSING", "error")],
        kind: "spf",
        verdict: "fail",
      },
    ]);

    expect(exitCodeFor(failed)).toBe(EXIT_PROBLEM);
  });

  it("gives 'could not tell' its own code", () => {
    // Collapsing this into 1 would undo, at the one place a script reads, the
    // distinction the resolver keeps all the way down. A deploy failing on a
    // resolver blip is exactly what the four-valued verdict exists to prevent.
    expect(exitCodeFor(result("indeterminate", []))).toBe(EXIT_UNKNOWN);
    expect(EXIT_UNKNOWN).not.toBe(EXIT_PROBLEM);
  });

  it("prefers the failure when a run has both", () => {
    const mixed = result("fail", [
      {
        findings: [finding("SPF_RECORD_MISSING", "error")],
        kind: "spf",
        verdict: "fail",
      },
      { kind: "caa", verdict: "indeterminate" },
    ]);

    expect(exitCodeFor(mixed)).toBe(EXIT_PROBLEM);
  });
});

describe("the report", () => {
  it("puts the worst check first", () => {
    const lines = render(
      result("fail", [
        { kind: "spf", verdict: "pass" },
        {
          findings: [finding("MX_MAIL_NOT_ACCEPTED", "error")],
          kind: "mx",
          verdict: "fail",
        },
        { kind: "caa", verdict: "warn" },
      ]),
      { style, trace: false }
    );

    const order = lines
      .filter((line) => CHECK_LINE.test(line))
      .map((line) => line.trim().split(" ").at(-1));

    expect(order).toEqual(["mx", "caa", "spf"]);
  });

  it("lines the check names up whatever the mark", () => {
    const lines = render(
      result("fail", [
        { kind: "spf", verdict: "pass" },
        { kind: "mx", verdict: "fail" },
      ]),
      { style, trace: false }
    );

    const columns = lines
      .filter((line) => line.endsWith("spf") || line.endsWith("mx"))
      .map((line) => line.length - (line.endsWith("spf") ? 3 : 2));

    expect(columns).toHaveLength(2);
    expect(new Set(columns).size).toBe(1);
  });

  it("shows what was found and what was wanted", () => {
    const lines = render(
      result("fail", [
        {
          findings: [
            finding("SPF_SOURCE_NOT_AUTHORIZED", "error", {
              expected: "include:_spf.example.net",
              observed: "one.example.org",
            }),
          ],
          kind: "spf",
          verdict: "fail",
        },
      ]),
      { style, trace: false }
    ).join("\n");

    expect(lines).toContain("found:  one.example.org");
    expect(lines).toContain("wanted: include:_spf.example.net");
    // The code is printed so it can be looked up and switched on.
    expect(lines).toContain("SPF_SOURCE_NOT_AUTHORIZED");
  });

  it("does not count an info finding as a problem", () => {
    // MX_NULL fires on every correctly configured sending-only domain.
    const lines = render(
      result("pass", [
        { findings: [finding("MX_NULL", "info")], kind: "mx", verdict: "pass" },
      ]),
      { style, trace: false }
    ).join("\n");

    expect(lines).toContain("nothing to fix");
  });

  it("emits no escape codes when colour is off", () => {
    const lines = render(result("fail", [{ kind: "spf", verdict: "fail" }]), {
      style,
      trace: false,
    }).join("\n");

    expect(ESCAPE.test(lines)).toBe(false);
  });

  it("emits them when it is on", () => {
    const lines = render(result("fail", [{ kind: "spf", verdict: "fail" }]), {
      style: { colour: true },
      trace: false,
    }).join("\n");

    expect(ESCAPE.test(lines)).toBe(true);
  });
});
