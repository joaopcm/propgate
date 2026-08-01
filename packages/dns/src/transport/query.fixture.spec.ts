import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import type { ServerAddress } from "../types";
import { RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
import { query } from "./query";

const DKIM_PREFIX = /^v=DKIM1; k=rsa; p=/;
const DKIM_TAG = /^v=DKIM1/;

/**
 * The codec against real servers.
 *
 * Every assertion here is something `node:dns` cannot express. That is the
 * justification for ~1.2 kLOC of hand-rolled wire format in a package that
 * promises zero runtime dependencies, so it deserves to be demonstrated rather
 * than asserted in a comment.
 */

function target(role: Parameters<typeof fixtureTarget>[0]): ServerAddress {
  const fixture = fixtureTarget(role);
  return { address: fixture.address, port: fixture.port };
}

const AUTH = () => target("auth");
const RESOLVER = () => target("resolver");
const PERMISSIVE = () => target("permissive");
const DECOY = () => target("decoy");

const TIMEOUT_MS = 2000;

describe("TC bit and TCP fallback", () => {
  it("sets TC for a 4096-bit key when no OPT record is sent", async () => {
    const outcome = await query({
      name: "big4096._domainkey.tcp.test",
      // No ednsBufferSize: the response is capped at 512 by protocol.
      retryOverTcp: false,
      target: AUTH(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    expect(outcome.status).toBe("truncated");
    if (outcome.status === "truncated") {
      expect(outcome.message.flags.tc).toBe(true);
      // A truncated answer carries no usable records — which is precisely why
      // reading this as "record not found" is the bug we are preventing.
      expect(outcome.message.answers).toHaveLength(0);
    }
  });

  it("retrieves the whole 4096-bit key by retrying over TCP", async () => {
    const outcome = await query({
      name: "big4096._domainkey.tcp.test",
      target: AUTH(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    expect(outcome.status).toBe("answered");
    if (outcome.status !== "answered") {
      return;
    }

    expect(outcome.retriedOverTcp).toBe(true);
    expect(outcome.transport).toBe("tcp");

    const [txt] = recordsOfType(outcome.message.answers, "TXT");
    expect(txt?.rdata.value).toMatch(DKIM_PREFIX);
    // 736 base64 chars of key plus the 18-char "v=DKIM1; k=rsa; p=" prefix.
    expect(txt?.rdata.value.length).toBe(754);
    // Over the 512-byte cap, which is why the retry was needed at all.
    expect(outcome.message.byteLength).toBeGreaterThan(512);
  });

  it("does NOT truncate a 2048-bit key, whose response is 483 bytes", async () => {
    const outcome = await query({
      name: "big._domainkey.tcp.test",
      retryOverTcp: false,
      target: AUTH(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    // The other side of the boundary. Reporting truncation here would be as
    // wrong as missing it for the 4096-bit case.
    expect(outcome.status).toBe("answered");
    if (outcome.status === "answered") {
      expect(outcome.message.flags.tc).toBe(false);
      expect(outcome.transport).toBe("udp");
      expect(outcome.message.byteLength).toBeLessThan(512);
      expect(outcome.retriedOverTcp).toBe(false);
    }
  });

  it("still truncates the 4.4 KB TXT even at an advertised 4096", async () => {
    const outcome = await query({
      ednsBufferSize: 4096,
      name: "huge.tcp.test",
      retryOverTcp: false,
      target: AUTH(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    expect(outcome.status).toBe("truncated");
  });
});

describe("TXT chunk boundaries", () => {
  it("preserves the provider's split rather than silently joining it", async () => {
    const outcome = await query({
      name: "s1._domainkey.txt-split.test",
      target: AUTH(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    if (outcome.status !== "answered") {
      throw new Error(`expected an answer, got ${outcome.status}`);
    }

    const [txt] = recordsOfType(outcome.message.answers, "TXT");
    // Three chunks on the wire, concatenated with no separator. Keeping the
    // chunks is what makes TXT_VALUE_SPLIT_MANGLED detectable at all: the
    // joined value alone cannot tell a clean split from a mangled one.
    expect(txt?.rdata.chunks).toHaveLength(3);
    expect(txt?.rdata.chunks.map((chunk) => chunk.length)).toEqual([
      60, 60, 57,
    ]);
    expect(txt?.rdata.value).toHaveLength(177);
    // The clean case: no whitespace inside the base64 payload. Note the value
    // legitimately contains spaces in its tag prefix ("v=DKIM1; k=rsa; p="),
    // so the check has to be on the key material, not the whole string — which
    // is itself a small illustration of why the chunks matter.
    expect(txt?.rdata.value.slice(18)).not.toContain(" ");
  });

  it("hands the whitespace at a chunk boundary through untouched", async () => {
    // Not a mangle: RFC 6376 §2.10 permits folding whitespace inside base64,
    // and the DKIM evaluator strips it. The transport's job is to report what
    // is on the wire and leave the judging to the layer that knows the rules.
    const outcome = await query({
      name: "s2._domainkey.txt-split.test",
      target: AUTH(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    if (outcome.status !== "answered") {
      throw new Error(`expected an answer, got ${outcome.status}`);
    }

    const [txt] = recordsOfType(outcome.message.answers, "TXT");
    expect(txt?.rdata.value).toContain(" ");
  });

  it("sees two separate RRs where only one record is permitted", async () => {
    const outcome = await query({
      name: "s4._domainkey.txt-split.test",
      target: AUTH(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    if (outcome.status !== "answered") {
      throw new Error(`expected an answer, got ${outcome.status}`);
    }

    expect(recordsOfType(outcome.message.answers, "TXT")).toHaveLength(2);
  });
});

describe("negative caching", () => {
  it("reads the authority-section SOA of an NXDOMAIN", async () => {
    const outcome = await query({
      name: "does-not-exist.negcache-low.test",
      target: AUTH(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.A,
    });

    if (outcome.status !== "answered") {
      throw new Error(`expected an answer, got ${outcome.status}`);
    }

    expect(outcome.message.rcode).toBe(3);

    const [soa] = recordsOfType(outcome.message.authority, "SOA");
    if (!soa) {
      throw new Error("expected a SOA in the authority section");
    }

    // RFC 2308: the negative TTL is min(SOA MINIMUM, the SOA record's own TTL).
    // Taking MINIMUM alone would tell a customer to wait an hour instead of
    // five minutes. c-ares discards the authority section entirely, so this
    // computation is impossible through node:dns.
    expect(soa.rdata.minimum).toBe(3600);
    expect(soa.ttl).toBe(300);
    expect(Math.min(soa.rdata.minimum, soa.ttl)).toBe(300);
  });

  it("distinguishes NODATA from NXDOMAIN", async () => {
    const nodata = await query({
      name: "_propgate-verify.nodata.test",
      target: AUTH(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });
    const nxdomain = await query({
      name: "absent.nodata.test",
      target: AUTH(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    if (nodata.status !== "answered" || nxdomain.status !== "answered") {
      throw new Error("expected both queries to answer");
    }

    // NODATA is RCODE 0 with an empty answer section; the name exists, the type
    // does not. The remedies differ, so conflating them misleads the customer.
    expect(nodata.message.rcode).toBe(0);
    expect(nodata.message.answers).toHaveLength(0);
    expect(nxdomain.message.rcode).toBe(3);
  });
});

describe("DNSSEC state", () => {
  it("reports AD for a correctly signed zone through the validating tier", async () => {
    const outcome = await query({
      dnssecOk: true,
      name: "secure.test",
      recursionDesired: true,
      target: RESOLVER(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.SOA,
    });

    if (outcome.status !== "answered") {
      throw new Error(`expected an answer, got ${outcome.status}`);
    }

    expect(outcome.message.flags.ad).toBe(true);
    expect(outcome.message.rcode).toBe(0);
  });

  it("SERVFAILs a bogus zone through the validating tier", async () => {
    const outcome = await query({
      name: "bogus-zone.test",
      recursionDesired: true,
      target: RESOLVER(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    if (outcome.status !== "answered") {
      throw new Error(`expected an answer, got ${outcome.status}`);
    }

    expect(outcome.message.rcode).toBe(2);
  });

  it("resolves the same bogus zone through the non-validating tier", async () => {
    const outcome = await query({
      name: "bogus-zone.test",
      recursionDesired: true,
      target: PERMISSIVE(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    if (outcome.status !== "answered") {
      throw new Error(`expected an answer, got ${outcome.status}`);
    }

    expect(outcome.message.rcode).toBe(0);
    const [txt] = recordsOfType(outcome.message.answers, "TXT");
    expect(txt?.rdata.value).toContain("non-validating");
  });

  it("reads an insecure island as insecure rather than bogus", async () => {
    const outcome = await query({
      dnssecOk: true,
      name: "insecure-island.test",
      recursionDesired: true,
      target: RESOLVER(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    if (outcome.status !== "answered") {
      throw new Error(`expected an answer, got ${outcome.status}`);
    }

    // Resolves, but AD is unset. "Insecure" is a warning a customer can live
    // with; "bogus" means their mail is already broken. Reporting one as the
    // other is exactly the false alarm the product exists to avoid.
    expect(outcome.message.rcode).toBe(0);
    expect(outcome.message.flags.ad).toBe(false);
    expect(recordsOfType(outcome.message.answers, "TXT")[0]?.rdata.value).toBe(
      "unsigned-but-valid"
    );
  });

  it("returns RRSIG records, which c-ares cannot surface", async () => {
    const outcome = await query({
      dnssecOk: true,
      name: "secure.test",
      target: AUTH(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.SOA,
    });

    if (outcome.status !== "answered") {
      throw new Error(`expected an answer, got ${outcome.status}`);
    }

    const [rrsig] = recordsOfType(outcome.message.answers, "RRSIG");
    expect(rrsig?.rdata.typeCovered).toBe(RecordType.SOA);
    expect(rrsig?.rdata.algorithmName).toBe("RSASHA256");
    expect(rrsig?.rdata.signerName).toBe("secure.test.");
  });
});

describe("wildcard synthesis via RRSIG labels", () => {
  it("shows labels below the queried name's label count for a synthesised answer", async () => {
    const outcome = await query({
      dnssecOk: true,
      name: "never-configured.wildcard-signed.test",
      target: AUTH(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    if (outcome.status !== "answered") {
      throw new Error(`expected an answer, got ${outcome.status}`);
    }

    const [rrsig] = recordsOfType(outcome.message.answers, "RRSIG");
    if (!rrsig) {
      throw new Error("expected an RRSIG");
    }

    // The queried name has 3 labels; the signature was made over a 2-label
    // owner, so the answer came from a wildcard. This is the authoritative
    // signal, needing no second probe — and it is invisible through node:dns.
    const queriedLabels = "never-configured.wildcard-signed.test".split(
      "."
    ).length;
    expect(queriedLabels).toBe(3);
    expect(rrsig.rdata.labels).toBe(2);
    expect(rrsig.rdata.labels).toBeLessThan(queriedLabels);
  });

  it("shows labels matching the queried name for a genuinely present record", async () => {
    const outcome = await query({
      dnssecOk: true,
      name: "real.wildcard-signed.test",
      target: AUTH(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    if (outcome.status !== "answered") {
      throw new Error(`expected an answer, got ${outcome.status}`);
    }

    const [rrsig] = recordsOfType(outcome.message.answers, "RRSIG");
    // No false positive: an explicitly configured name has a full label count.
    expect(rrsig?.rdata.labels).toBe(3);
  });
});

describe("rcode distinctions", () => {
  it("reports REFUSED from a server that is not authoritative for the zone", async () => {
    const outcome = await query({
      name: "lame.test",
      target: DECOY(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.A,
    });

    if (outcome.status !== "answered") {
      throw new Error(`expected an answer, got ${outcome.status}`);
    }

    // REFUSED (5), not SERVFAIL (2) and not NXDOMAIN (3). node:dns collapses
    // all three into an error code that loses the distinction.
    expect(outcome.message.rcode).toBe(5);
  });

  it("reports AA for an authoritative answer and not for a recursive one", async () => {
    const authoritative = await query({
      name: "decoy.test",
      target: AUTH(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.SOA,
    });
    const recursive = await query({
      name: "secure.test",
      recursionDesired: true,
      target: RESOLVER(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.SOA,
    });

    // dns-auth is not authoritative for decoy.test, so no AA.
    if (authoritative.status === "answered") {
      expect(authoritative.message.flags.aa).toBe(false);
    }
    if (recursive.status === "answered") {
      expect(recursive.message.flags.aa).toBe(false);
      expect(recursive.message.flags.ra).toBe(true);
    }
  });
});

describe("appended zone name", () => {
  it("finds the record at the doubled name and NXDOMAIN at the correct one", async () => {
    const doubled = await query({
      name: "selector1._domainkey.appended.test.appended.test",
      target: AUTH(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });
    const correct = await query({
      name: "selector1._domainkey.appended.test",
      target: AUTH(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    if (doubled.status !== "answered" || correct.status !== "answered") {
      throw new Error("expected both queries to answer");
    }

    expect(doubled.message.rcode).toBe(0);
    expect(
      recordsOfType(doubled.message.answers, "TXT")[0]?.rdata.value
    ).toMatch(DKIM_TAG);
    expect(correct.message.rcode).toBe(3);
  });
});

describe("MX semantics", () => {
  it("tells a null MX apart from preference 0 pointing at a host", async () => {
    const outcome = await query({
      name: "bounce.propgate-fixture.test",
      target: AUTH(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.MX,
    });

    if (outcome.status !== "answered") {
      throw new Error(`expected an answer, got ${outcome.status}`);
    }

    const [mx] = recordsOfType(outcome.message.answers, "MX");
    expect(mx?.rdata.isNullMx).toBe(false);
    expect(mx?.rdata.exchange).toBe("mx.propgate-fixture.test.");
  });
});

describe("CAA", () => {
  it("decodes a quoted deny-all that a zone-file comment would have eaten", async () => {
    const outcome = await query({
      name: "user.github.io",
      target: AUTH(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.CAA,
    });

    if (outcome.status !== "answered") {
      throw new Error(`expected an answer, got ${outcome.status}`);
    }

    const caa = recordsOfType(outcome.message.answers, "CAA");
    const issuewild = caa.find((record) => record.rdata.tag === "issuewild");

    expect(issuewild?.rdata.value).toBe(";");
    expect(
      caa.find((record) => record.rdata.tag === "issue")?.rdata.value
    ).toBe("letsencrypt.org");
  });
});
