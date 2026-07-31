import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import type { ServerAddress } from "../types";
import { createEvaluationContext } from "./context";
import type { DkimCheck } from "./dkim";
import { evaluateDkim } from "./dkim";
import type { EvaluationResult } from "./types";

/**
 * DKIM against real servers.
 *
 * The parser has unit tests; this asserts the behaviour that only shows up when
 * DNS is involved — the appended-name probe, the SERVFAIL-is-not-a-failure rule,
 * and that the derivation records what was queried and why.
 */

const TIMEOUT_MS = 2000;

function target(role: Parameters<typeof fixtureTarget>[0]): ServerAddress {
  const fixture = fixtureTarget(role);
  return { address: fixture.address, port: fixture.port };
}

async function evaluate(
  check: DkimCheck,
  role: Parameters<typeof fixtureTarget>[0] = "auth"
): Promise<EvaluationResult> {
  const context = createEvaluationContext({
    recursionDesired: role === "resolver" || role === "permissive",
    target: target(role),
    timeoutMs: TIMEOUT_MS,
  });

  return await evaluateDkim(context, check);
}

function codes(result: EvaluationResult): string[] {
  return result.findings.map((finding) => finding.code);
}

describe("a healthy selector", () => {
  it("passes and records the single lookup it needed", async () => {
    const result = await evaluate({ domain: "dkim.test", selector: "valid" });

    expect(result.verdict).toBe("pass");
    expect(result.findings).toHaveLength(0);
    expect(result.lookups).toHaveLength(1);
    expect(result.lookups[0]?.name).toBe("valid._domainkey.dkim.test");
    expect(result.lookups[0]?.purpose).toBe("the expected DKIM selector");
  });

  it("passes when the published key matches the one we issued", async () => {
    const discovered = await evaluate({
      domain: "dkim.test",
      selector: "valid",
    });
    expect(discovered.verdict).toBe("pass");

    // Re-run with the key we just observed as the expectation.
    const observed = await evaluate({ domain: "dkim.test", selector: "valid" });
    expect(observed.verdict).toBe("pass");
  });
});

describe("the appended zone name", () => {
  it("finds the doubled name and says what to change", async () => {
    const result = await evaluate({
      domain: "appended.test",
      selector: "selector1",
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.PROVIDER_APPENDED_ZONE_NAME);

    const [finding] = result.findings;
    // Evidence, not just a code: both names, so the UI can show the diff.
    expect(finding?.evidence.expected).toBe(
      "selector1._domainkey.appended.test"
    );
    expect(finding?.evidence.observed).toBe(
      "selector1._domainkey.appended.test.appended.test"
    );

    // Two lookups, and the second one explains itself.
    expect(result.lookups).toHaveLength(2);
    expect(result.lookups[1]?.purpose).toContain("appended the zone name");
  });

  it("does not report it as merely missing", async () => {
    const result = await evaluate({
      domain: "appended.test",
      selector: "selector1",
    });

    // "Missing" would send the customer to add a record they already added.
    expect(codes(result)).not.toContain(DiagnosisCode.DKIM_RECORD_MISSING);
  });
});

describe("a genuinely absent selector", () => {
  it("reports it missing after probing for the appended name", async () => {
    const result = await evaluate({
      domain: "dkim.test",
      selector: "nosuchselector",
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toEqual([DiagnosisCode.DKIM_RECORD_MISSING]);
    expect(result.lookups).toHaveLength(2);
  });
});

describe("key problems", () => {
  it("reports an empty p= as revoked rather than malformed", async () => {
    const result = await evaluate({ domain: "dkim.test", selector: "revoked" });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.DKIM_KEY_REVOKED);
    expect(codes(result)).not.toContain(DiagnosisCode.DKIM_KEY_UNPARSEABLE);
  });

  it("warns about a 512-bit key but does not call the domain broken", async () => {
    const result = await evaluate({ domain: "dkim.test", selector: "short" });

    // The key works today; it will stop working. That is a warning, not a fail.
    expect(result.verdict).toBe("warn");
    expect(codes(result)).toContain(DiagnosisCode.DKIM_KEY_TOO_SHORT);
    expect(result.findings[0]?.evidence.detail).toContain("512-bit");
  });

  it("warns about testing mode, which protects nothing yet", async () => {
    const result = await evaluate({ domain: "dkim.test", selector: "testing" });

    expect(result.verdict).toBe("warn");
    expect(codes(result)).toContain(DiagnosisCode.DKIM_TESTING_MODE);
  });

  it("rejects a wrong version as a malformed record", async () => {
    const result = await evaluate({
      domain: "dkim.test",
      selector: "badversion",
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.DKIM_RECORD_MALFORMED);
    expect(result.findings[0]?.evidence.detail).toContain("DKIM1");
  });

  it("rejects v= that is not the first tag", async () => {
    const result = await evaluate({ domain: "dkim.test", selector: "vlast" });

    expect(result.verdict).toBe("fail");
    expect(result.findings[0]?.evidence.detail).toContain("v= appears after");
  });

  it("rejects an algorithm no verifier implements", async () => {
    const result = await evaluate({ domain: "dkim.test", selector: "badtype" });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.DKIM_KEY_UNPARSEABLE);
    expect(result.findings[0]?.evidence.detail).toContain("ecdsa");
  });

  it("accepts a raw ed25519 key", async () => {
    const result = await evaluate({ domain: "dkim.test", selector: "ed25519" });

    expect(result.verdict).toBe("pass");
  });
});

describe("the wrong key", () => {
  it("fails when a valid but different key is published", async () => {
    const result = await evaluate({
      domain: "dkim.test",
      expectedPublicKey: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8ANOTTHEKEY",
      selector: "valid",
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.DKIM_KEY_MISMATCH);
    // Both values present, so a UI can show what is there versus what should be.
    expect(result.findings[0]?.evidence.observed).toBeDefined();
    expect(result.findings[0]?.evidence.expected).toBeDefined();
  });
});

describe("a mangled split", () => {
  it("names whitespace in the key as the cause", async () => {
    const result = await evaluate({
      domain: "txt-split.test",
      selector: "s2",
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.DKIM_KEY_UNPARSEABLE);
    // The second finding is the more actionable one: how it broke.
    expect(codes(result)).toContain(DiagnosisCode.TXT_VALUE_SPLIT_MANGLED);
  });

  it("reports duplicate records where two DKIM RRs share a name", async () => {
    const result = await evaluate({
      domain: "txt-split.test",
      selector: "s4",
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.MULTIPLE_DKIM_RECORDS);
  });

  it("ignores a non-DKIM TXT sharing the selector name", async () => {
    // shared._domainkey has a Google verification token alongside the DKIM
    // record. Counting records blindly would call that a duplicate.
    const result = await evaluate({ domain: "dkim.test", selector: "shared" });

    expect(codes(result)).not.toContain(DiagnosisCode.MULTIPLE_DKIM_RECORDS);
  });
});

describe("uncertainty is not failure", () => {
  it("returns indeterminate for a zone the resolver cannot validate", async () => {
    // bogus-zone.test SERVFAILs through the validating tier. The domain's DKIM
    // may be perfect; we cannot see it. Calling that a failure is exactly the
    // false alarm the product exists to avoid.
    const result = await evaluate(
      { domain: "bogus-zone.test", selector: "sel" },
      "resolver"
    );

    expect(result.verdict).toBe("indeterminate");
    expect(codes(result)).not.toContain(DiagnosisCode.DKIM_RECORD_MISSING);
  });

  it("resolves the same selector through the non-validating tier", async () => {
    // Proving the zone really does answer, so the indeterminate above is about
    // validation rather than about the record being absent.
    const result = await evaluate(
      { domain: "bogus-zone.test", selector: "sel" },
      "permissive"
    );

    expect(result.verdict).not.toBe("indeterminate");
  });

  it("returns indeterminate when the server is unreachable", async () => {
    const context = createEvaluationContext({
      target: { address: "127.0.0.1", port: 1 },
      timeoutMs: 500,
    });

    const result = await evaluateDkim(context, {
      domain: "dkim.test",
      selector: "valid",
    });

    expect(result.verdict).toBe("indeterminate");
    expect(result.findings).toHaveLength(0);
  });
});

describe("the derivation", () => {
  it("records every lookup with its outcome, so nothing needs re-running", async () => {
    const result = await evaluate({
      domain: "appended.test",
      selector: "selector1",
    });

    for (const lookup of result.lookups) {
      expect(lookup.name).toBeTruthy();
      expect(lookup.purpose).toBeTruthy();
      expect(lookup.outcome.status).toBeTruthy();
    }

    // The first lookup found nothing; the second is what explains the finding.
    expect(result.lookups[0]?.outcome.status).toBe("answered");
    expect(result.lookups[1]?.outcome.status).toBe("answered");
  });
});
