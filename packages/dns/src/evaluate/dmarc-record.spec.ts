import { describe, expect, it } from "vitest";
import {
  effectivePolicy,
  looksLikeDmarc,
  parseDmarcRecord,
} from "./dmarc-record";

/** Parsing is pure, so these are unit tests. Discovery is in the fixture spec. */

function record(value: string) {
  const parsed = parseDmarcRecord(value);

  if (!parsed.ok) {
    throw new Error(`expected a parseable record, got ${parsed.issue}`);
  }

  return parsed.record;
}

describe("looksLikeDmarc", () => {
  it("accepts a record that begins with v=DMARC1", () => {
    expect(looksLikeDmarc("v=DMARC1; p=none")).toBe(true);
    expect(looksLikeDmarc("  v=DMARC1  ; p=none")).toBe(true);
    expect(looksLikeDmarc("v=dmarc1; p=none")).toBe(true);
  });

  it("rejects anything else, so unrelated TXT records are discarded first", () => {
    // RFC 7489 §6.6.3 filters before counting. Without that, a domain with a
    // policy and a verification token would read as ambiguous.
    expect(looksLikeDmarc("google-site-verification=abc")).toBe(false);
    expect(looksLikeDmarc("v=spf1 -all")).toBe(false);
    expect(looksLikeDmarc("p=reject; v=DMARC1")).toBe(false);
  });
});

describe("parseDmarcRecord", () => {
  it("parses a full policy", () => {
    const parsed = record(
      "v=DMARC1; p=reject; sp=quarantine; adkim=s; aspf=s; pct=50; rua=mailto:a@example.com"
    );

    expect(parsed.policy).toBe("reject");
    expect(parsed.subdomainPolicy).toBe("quarantine");
    expect(parsed.dkimAlignment).toBe("s");
    expect(parsed.spfAlignment).toBe("s");
    expect(parsed.percent).toBe(50);
    expect(parsed.aggregateReportUris).toHaveLength(1);
  });

  it("defaults alignment to relaxed and pct to 100", () => {
    const parsed = record("v=DMARC1; p=none");

    expect(parsed.dkimAlignment).toBe("r");
    expect(parsed.spfAlignment).toBe("r");
    expect(parsed.percent).toBe(100);
  });

  it("parses a report URI list with size limits", () => {
    const parsed = record(
      "v=DMARC1; p=none; rua=mailto:a@example.com!10m,mailto:b@other.example"
    );

    expect(parsed.aggregateReportUris.map((uri) => uri.target)).toEqual([
      "a@example.com",
      "b@other.example",
    ]);
    expect(parsed.aggregateReportUris[0]?.sizeLimit).toBe("10m");
    expect(parsed.aggregateReportUris[1]?.sizeLimit).toBeUndefined();
  });

  it("keeps a URI with no scheme rather than discarding it", () => {
    // The evaluator reports it; throwing it away here would hide the mistake.
    const parsed = record("v=DMARC1; p=none; rua=dmarc@example.com");

    expect(parsed.aggregateReportUris[0]?.scheme).toBe("");
    expect(parsed.aggregateReportUris[0]?.raw).toBe("dmarc@example.com");
  });

  it("rejects a record that is not DMARC", () => {
    const parsed = parseDmarcRecord("v=spf1 -all");

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issue).toBe("not-dmarc");
    }
  });

  it("rejects v= that is not the first tag", () => {
    const parsed = parseDmarcRecord("p=reject; v=DMARC1");

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      // Caught by the not-dmarc filter first, which is the same outcome a
      // receiver reaches: the record is not recognised as DMARC at all.
      expect(parsed.issue).toBe("not-dmarc");
    }
  });

  it("rejects an unknown policy value", () => {
    const parsed = parseDmarcRecord("v=DMARC1; p=block");

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issue).toBe("invalid-policy");
      expect(parsed.detail).toContain("block");
    }
  });

  it("rejects pct above 100", () => {
    const parsed = parseDmarcRecord("v=DMARC1; p=reject; pct=150");

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issue).toBe("invalid-percent");
    }
  });

  it("rejects a non-numeric pct", () => {
    const parsed = parseDmarcRecord("v=DMARC1; p=reject; pct=half");

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issue).toBe("invalid-percent");
    }
  });

  it("rejects an alignment mode that is not r or s", () => {
    const parsed = parseDmarcRecord("v=DMARC1; p=reject; adkim=strict");

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issue).toBe("invalid-alignment");
    }
  });

  it("rejects a duplicated tag rather than picking one", () => {
    const parsed = parseDmarcRecord("v=DMARC1; p=reject; p=none");

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issue).toBe("duplicate-tag");
    }
  });

  it("allows a record with no p=, which the evaluator reports", () => {
    // Legal to parse, useless as a policy. Splitting those two judgements keeps
    // the parser about syntax and the evaluator about meaning.
    expect(record("v=DMARC1; rua=mailto:a@example.com").policy).toBeUndefined();
  });
});

describe("effectivePolicy", () => {
  it("uses p= when the record was found at the exact name", () => {
    const parsed = record("v=DMARC1; p=none; sp=reject");

    // sp= is irrelevant here: the subdomain published its own record, so its
    // p= governs. Applying sp= would enforce a policy the owner did not set
    // for this name.
    expect(effectivePolicy(parsed, "exact")).toBe("none");
  });

  it("uses sp= when the policy was inherited from the org domain", () => {
    const parsed = record("v=DMARC1; p=reject; sp=quarantine");

    expect(effectivePolicy(parsed, "organizational")).toBe("quarantine");
  });

  it("falls back to p= when inherited and no sp= is set", () => {
    const parsed = record("v=DMARC1; p=reject");

    expect(effectivePolicy(parsed, "organizational")).toBe("reject");
  });
});
