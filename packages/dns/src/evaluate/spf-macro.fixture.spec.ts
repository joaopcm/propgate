import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import type { ServerAddress } from "../types";
import { createEvaluationContext } from "./context";
import type { SpfCheck } from "./spf";
import { evaluateSpf } from "./spf";
import type { EvaluationResult } from "./types";

/**
 * Macros against real servers.
 *
 * The unit spec proves the grammar produces the right string; this proves the
 * evaluator then queries that string. Between the two, an expansion that is
 * correct but never used would still fail a test.
 */

const TIMEOUT_MS = 2000;

function target(role: Parameters<typeof fixtureTarget>[0]): ServerAddress {
  const fixture = fixtureTarget(role);
  return { address: fixture.address, port: fixture.port };
}

async function evaluate(check: SpfCheck): Promise<EvaluationResult> {
  const context = createEvaluationContext({
    maxLookups: 60,
    target: target("auth"),
    timeoutMs: TIMEOUT_MS,
  });

  return await evaluateSpf(context, check);
}

function codes(result: EvaluationResult): string[] {
  return result.findings.map((finding) => finding.code);
}

function ipOutcome(result: EvaluationResult): string | undefined {
  return codes(result).find((code) => code.startsWith("SPF_IP_"));
}

describe("%{ir} and %{v} in an exists: term", () => {
  it("queries the expanded name and authorises the sender", async () => {
    const result = await evaluate({
      domain: "macroexists.spf.test",
      ip: "198.51.100.7",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_AUTHORIZED);
    expect(result.lookups.map((lookup) => lookup.name)).toContain(
      "7.100.51.198.in-addr._spf.spf.test"
    );
  });

  it("asks a different question for a different sender", async () => {
    // The whole point of the mechanism: one record, one name per address. The
    // name for this address does not exist, so nothing authorises it.
    const result = await evaluate({
      domain: "macroexists.spf.test",
      ip: "198.51.100.8",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_NOT_AUTHORIZED);
    expect(result.lookups.map((lookup) => lookup.name)).toContain(
      "8.100.51.198.in-addr._spf.spf.test"
    );
  });

  it("counts the miss as a void lookup", async () => {
    // An exists: that resolves to nothing is a void lookup like any other, and
    // two more of them would be a permanent error.
    const result = await evaluate({
      domain: "macroexists.spf.test",
      ip: "198.51.100.8",
    });

    expect(codes(result)).toContain(DiagnosisCode.SPF_VOID_LOOKUP);
  });
});

describe("%{d}", () => {
  it("expands to the domain whose record is being read", async () => {
    const result = await evaluate({
      domain: "macrodomain.spf.test",
      ip: "198.51.100.60",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_AUTHORIZED);
    expect(result.lookups.map((lookup) => lookup.name)).toContain(
      "mail.macrodomain.spf.test"
    );
  });
});

describe("%{l}", () => {
  it("uses the envelope sender when the check is given one", async () => {
    const result = await evaluate({
      domain: "macrosender.spf.test",
      ip: "198.51.100.7",
      sender: "strongbad@example.com",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_AUTHORIZED);
    expect(result.lookups.map((lookup) => lookup.name)).toContain(
      "strongbad._sender.spf.test"
    );
  });

  it("falls back to postmaster on a bounce", async () => {
    // RFC 7208 §4.3: an empty MAIL FROM becomes postmaster@<helo>. The name
    // that produces is not published here, so the sender is not authorised —
    // but it is a real question, not an undecidable one.
    const result = await evaluate({
      domain: "macrosender.spf.test",
      helo: "mta.example.com",
      ip: "198.51.100.7",
    });

    expect(ipOutcome(result)).toBe(DiagnosisCode.SPF_IP_NOT_AUTHORIZED);
    expect(result.lookups.map((lookup) => lookup.name)).toContain(
      "postmaster._sender.spf.test"
    );
  });
});

describe("what expansion still refuses to answer", () => {
  it("treats a macro that does not parse as a malformed record", async () => {
    // %{q} is not a macro letter, so the record is permanently wrong — caught
    // at parse time, before any lookup is spent on it.
    const result = await evaluate({
      domain: "macrobroken.spf.test",
      ip: "198.51.100.7",
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.SPF_RECORD_MALFORMED);
    expect(result.lookups).toHaveLength(1);
  });

  it("keeps a missing input separate from a broken record", async () => {
    // Nothing is wrong with macrosender.spf.test; this check simply was not
    // told who is sending. Reporting that as malformed would send the domain
    // owner to edit a record that is correct.
    const result = await evaluate({
      domain: "macrosender.spf.test",
      ip: "198.51.100.7",
    });

    expect(codes(result)).toContain(DiagnosisCode.SPF_MACRO_NOT_EVALUATED);
    expect(codes(result)).not.toContain(DiagnosisCode.SPF_RECORD_MALFORMED);
  });
});
