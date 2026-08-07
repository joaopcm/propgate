import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import type { ServerAddress } from "../types";
import { createEvaluationContext } from "./context";
import type { OwnershipCheck } from "./ownership";
import { evaluateOwnership } from "./ownership";
import type { EvaluationResult } from "./types";

/**
 * Ownership tokens against real servers.
 *
 * `nearMissFor` has unit tests; this asserts what only shows up with DNS in the
 * way — that the apex's crowd of unrelated TXT records does not count as a pass,
 * that a chunked value arrives joined the way RFC 6763 says, and that the
 * appended-name probe fires on the token rather than on the name answering.
 */

const TIMEOUT_MS = 2000;
const TOKEN = "propgate-verify=6c1f9a24b7e5d03812af49b6c5d0e7f3";
const LABEL = "_pg-challenge";

function target(role: Parameters<typeof fixtureTarget>[0]): ServerAddress {
  const fixture = fixtureTarget(role);
  return { address: fixture.address, port: fixture.port };
}

async function evaluate(check: OwnershipCheck): Promise<EvaluationResult> {
  return await evaluateOwnership(
    createEvaluationContext({ target: target("auth"), timeoutMs: TIMEOUT_MS }),
    check
  );
}

function codes(result: EvaluationResult): string[] {
  return result.findings.map((finding) => finding.code);
}

function detailOf(result: EvaluationResult, code: string): string {
  return (
    result.findings.find((finding) => finding.code === code)?.evidence.detail ??
    ""
  );
}

describe("a token published as issued", () => {
  it("passes on one lookup, with nothing to report", async () => {
    const result = await evaluate({
      domain: "ok.ownership.test",
      label: LABEL,
      token: TOKEN,
    });

    expect(result.verdict).toBe("pass");
    expect(result.findings).toHaveLength(0);
    expect(result.lookups).toHaveLength(1);
    expect(result.lookups[0]?.name).toBe("_pg-challenge.ok.ownership.test");
  });

  it("passes at the apex, among records belonging to other vendors", async () => {
    // The case a presence check gets wrong: this name has three TXT records and
    // only one of them is ours.
    const result = await evaluate({
      domain: "apex.ownership.test",
      token: TOKEN,
    });

    expect(result.verdict).toBe("pass");
    expect(result.findings).toHaveLength(0);
    expect(result.lookups[0]?.name).toBe("apex.ownership.test");
  });

  it("does not pass an apex crowded with records that are not the token", async () => {
    const result = await evaluate({
      domain: "apex.ownership.test",
      token: "propgate-verify=somebody-elses-token",
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.OWNERSHIP_TOKEN_MISMATCH);
  });
});

describe("a token that was published and then spent", () => {
  it("names the letter case, which is content in an opaque value", async () => {
    const result = await evaluate({
      domain: "cased.ownership.test",
      label: LABEL,
      token: TOKEN,
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toEqual([DiagnosisCode.OWNERSHIP_TOKEN_MISMATCH]);
    expect(detailOf(result, DiagnosisCode.OWNERSHIP_TOKEN_MISMATCH)).toContain(
      "letter case"
    );
  });

  it("names the quotes the provider stored as part of the value", async () => {
    const result = await evaluate({
      domain: "quoted.ownership.test",
      label: LABEL,
      token: TOKEN,
    });

    expect(result.verdict).toBe("fail");
    expect(detailOf(result, DiagnosisCode.OWNERSHIP_TOKEN_MISMATCH)).toContain(
      "quotes"
    );
  });

  it("counts the characters that survived a truncating field", async () => {
    const result = await evaluate({
      domain: "truncated.ownership.test",
      label: LABEL,
      token: TOKEN,
    });

    expect(result.verdict).toBe("fail");
    expect(detailOf(result, DiagnosisCode.OWNERSHIP_TOKEN_MISMATCH)).toContain(
      "truncated"
    );
  });

  it("blames the record editor when the chunks were rejoined with whitespace", async () => {
    // Two findings rather than one: the value is not the token, *and* the reason
    // is a fault in how it was stored. The second is the one that sends someone
    // to the right screen.
    const result = await evaluate({
      domain: "spaced.ownership.test",
      label: LABEL,
      token: TOKEN,
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toEqual([
      DiagnosisCode.OWNERSHIP_TOKEN_MISMATCH,
      DiagnosisCode.TXT_VALUE_SPLIT_MANGLED,
    ]);
  });

  it("says only that it is a different token when it is one", async () => {
    const result = await evaluate({
      domain: "stale.ownership.test",
      label: LABEL,
      token: TOKEN,
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toEqual([DiagnosisCode.OWNERSHIP_TOKEN_MISMATCH]);
    expect(detailOf(result, DiagnosisCode.OWNERSHIP_TOKEN_MISMATCH)).toContain(
      "none of them the token"
    );
  });
});

describe("a token that is not there", () => {
  it("reports it missing rather than mismatched", async () => {
    const result = await evaluate({
      domain: "missing.ownership.test",
      label: LABEL,
      token: TOKEN,
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toContain(DiagnosisCode.OWNERSHIP_TOKEN_MISSING);
    expect(codes(result)).not.toContain(DiagnosisCode.OWNERSHIP_TOKEN_MISMATCH);
  });

  it("finds it at the doubled name a provider would have written", async () => {
    const result = await evaluate({
      domain: "appended.test",
      label: LABEL,
      token: TOKEN,
    });

    expect(result.verdict).toBe("fail");
    expect(codes(result)).toEqual([DiagnosisCode.PROVIDER_APPENDED_ZONE_NAME]);
    expect(result.lookups[1]?.purpose).toContain("appended the zone name");
  });

  it("does not blame the provider when the doubled name carries someone else's token", async () => {
    // The probe is guarded on the token, not on the doubled name answering. A
    // wildcard answers it too, and an appended-zone-name finding raised by one
    // sends somebody to fix a record they wrote correctly.
    const result = await evaluate({
      domain: "appended.test",
      label: LABEL,
      token: "propgate-verify=0000000000000000000000000000dead",
    });

    expect(codes(result)).not.toContain(
      DiagnosisCode.PROVIDER_APPENDED_ZONE_NAME
    );
    expect(codes(result)).toContain(DiagnosisCode.OWNERSHIP_TOKEN_MISSING);
  });
});
