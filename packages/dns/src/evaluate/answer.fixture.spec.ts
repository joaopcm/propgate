import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { DiagnosisCode } from "../diagnosis/codes";
import type { ServerAddress } from "../types";
import { createEvaluationContext } from "./context";
import { evaluateDkim } from "./dkim";
import { evaluateSpf } from "./spf";
import type { EvaluationResult } from "./types";

/**
 * The shape of a negative answer, against real servers.
 *
 * Three codes that were published, documented and served by the API while being
 * unreachable, because nothing looked for them. Each says something the bare
 * absence does not.
 */

const TIMEOUT_MS = 2000;

function target(role: Parameters<typeof fixtureTarget>[0]): ServerAddress {
  const fixture = fixtureTarget(role);
  return { address: fixture.address, port: fixture.port };
}

function context(role: Parameters<typeof fixtureTarget>[0] = "resolver") {
  return createEvaluationContext({
    recursionDesired: role === "resolver",
    target: target(role),
    timeoutMs: TIMEOUT_MS,
  });
}

function codes(result: EvaluationResult): string[] {
  return result.findings.map((finding) => finding.code);
}

describe("NODATA is not NXDOMAIN", () => {
  it("says the name exists when it does", async () => {
    // nodata.test has records, just not this one. "Add the record" is the wrong
    // instruction; "look at what you already published here" is the right one.
    const result = await evaluateSpf(context(), { domain: "nodata.test" });

    expect(codes(result)).toContain(DiagnosisCode.SPF_RECORD_MISSING);
    expect(codes(result)).toContain(DiagnosisCode.NODATA_NOT_NXDOMAIN);
  });

  it("stays quiet when the name genuinely does not exist", async () => {
    const result = await evaluateSpf(context(), {
      domain: "nothing-here.spf.test",
    });

    expect(codes(result)).toContain(DiagnosisCode.SPF_RECORD_MISSING);
    expect(codes(result)).not.toContain(DiagnosisCode.NODATA_NOT_NXDOMAIN);
  });
});

describe("how long the absence will be remembered", () => {
  it("warns when a negative answer is cached for an hour", async () => {
    // RFC 2308 §5. A customer who adds the record still sees the absence for
    // that long, concludes the fix did not work, and changes something else.
    // Against the authoritative server, not the recursive one, and that is the
    // whole point. Unbound caches the zone's SOA and counts its TTL down, so
    // asked through the resolver this number shrinks with the age of the tier —
    // it was 3600 on a cold cache and 3580 twenty seconds later, and once it
    // falls under the fifteen-minute threshold the finding stops being emitted
    // at all. A fresh QNAME does not help: the cached rrset is the zone's SOA,
    // not the name's. The zone's configured value is the fact this asserts.
    const result = await evaluateSpf(context("auth"), {
      domain: "negcache-high.test",
    });

    expect(codes(result)).toContain(DiagnosisCode.NEGATIVE_CACHE_LIKELY);

    const finding = result.findings.find(
      (entry) => entry.code === DiagnosisCode.NEGATIVE_CACHE_LIKELY
    );

    expect(finding?.evidence.observed).toBe("3600s");
  });

  it("stays quiet at a minute, which nobody notices", async () => {
    const result = await evaluateSpf(context(), {
      domain: "negcache-low.test",
    });

    expect(codes(result)).not.toContain(DiagnosisCode.NEGATIVE_CACHE_LIKELY);
  });
});

describe("an answer that arrived over TCP", () => {
  it("is reported, because it is a hair away from not arriving", async () => {
    // tcp.test's key does not fit in a UDP packet, so the transport retried
    // over TCP. That works until a middlebox blocks port 53 on TCP, at which
    // point an intermittent fault becomes a permanent one.
    const result = await evaluateDkim(context("auth"), {
      domain: "tcp.test",
      selector: "big4096",
    });

    // The key itself is fine. That is the point: this is the finding that is
    // only interesting on a record that currently works.
    expect(codes(result)).toContain(DiagnosisCode.TRUNCATED_FELL_BACK_TO_TCP);
    expect(codes(result)).not.toContain(DiagnosisCode.DKIM_RECORD_MISSING);
    expect(result.verdict).toBe("pass");
  });
});
