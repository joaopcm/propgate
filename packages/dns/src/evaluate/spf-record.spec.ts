import { describe, expect, it } from "vitest";
import {
  containsMacro,
  countsAsLookup,
  directLookupCost,
  looksLikeSpf,
  parseSpfRecord,
} from "./spf-record";

/** Syntax is pure. The accounting and the include tree are in the fixture spec. */

function parse(raw: string) {
  const result = parseSpfRecord(raw);

  if (!result.ok) {
    throw new Error(`expected "${raw}" to parse: ${result.detail}`);
  }

  return result.record;
}

function reject(raw: string): string {
  const result = parseSpfRecord(raw);

  if (result.ok) {
    throw new Error(`expected "${raw}" to be rejected`);
  }

  return result.detail;
}

describe("looksLikeSpf", () => {
  it("accepts the version token in any case, with or without terms", () => {
    expect(looksLikeSpf("v=spf1")).toBe(true);
    expect(looksLikeSpf("V=SPF1 -all")).toBe(true);
    expect(looksLikeSpf("  v=spf1 -all  ")).toBe(true);
  });

  it("rejects anything else, so unrelated TXT records are not counted", () => {
    // Filtering before counting is what keeps a domain with one SPF record and
    // one verification token from being reported as having two.
    expect(looksLikeSpf("propgate-site-verification=abc")).toBe(false);
    expect(looksLikeSpf("v=spf10 -all")).toBe(false);
    expect(looksLikeSpf("v=DMARC1; p=none")).toBe(false);
  });
});

describe("qualifiers", () => {
  it("defaults to + when none is written", () => {
    expect(parse("v=spf1 all").all?.qualifier).toBe("+");
  });

  it("reads each of the four", () => {
    for (const qualifier of ["+", "-", "~", "?"]) {
      expect(parse(`v=spf1 ${qualifier}all`).all?.qualifier).toBe(qualifier);
    }
  });
});

describe("ip4 and ip6", () => {
  it("keeps an address with no prefix as a single host", () => {
    const record = parse("v=spf1 ip4:198.51.100.1 -all");
    const [mechanism] = record.terms;

    expect(mechanism).toMatchObject({ prefix4: 32, value: "198.51.100.1" });
  });

  it("reads a CIDR prefix", () => {
    expect(parse("v=spf1 ip4:198.51.100.0/24 -all").terms[0]).toMatchObject({
      prefix4: 24,
    });
    expect(parse("v=spf1 ip6:2001:db8::/32 -all").terms[0]).toMatchObject({
      prefix6: 32,
    });
  });

  it("rejects an address that is not one", () => {
    // A permerror, not a term that quietly matches nothing: receivers stop
    // reading the record here.
    expect(reject("v=spf1 ip4:198.51.100.999 -all")).toContain("not an IPv4");
    expect(reject("v=spf1 ip4:2001:db8::1 -all")).toContain("not an IPv4");
    expect(reject("v=spf1 ip6:198.51.100.1 -all")).toContain("not an IPv6");
  });

  it("rejects a prefix wider than the address", () => {
    expect(reject("v=spf1 ip4:198.51.100.0/33 -all")).toContain("exceeds");
    expect(reject("v=spf1 ip6:2001:db8::/129 -all")).toContain("exceeds");
  });

  it("rejects an address with no argument at all", () => {
    expect(reject("v=spf1 ip4 -all")).toContain("needs an address");
  });
});

describe("a and mx", () => {
  it("takes no domain, meaning the current one", () => {
    const [mechanism] = parse("v=spf1 a -all").terms;

    expect(mechanism).toMatchObject({ name: "a" });
    expect(mechanism).not.toHaveProperty("value");
  });

  it("reads a dual CIDR length", () => {
    expect(parse("v=spf1 a:example.com/24//64 -all").terms[0]).toMatchObject({
      prefix4: 24,
      prefix6: 64,
      value: "example.com",
    });
  });

  it("reads a bare dual CIDR with no domain", () => {
    expect(parse("v=spf1 mx/24 -all").terms[0]).toMatchObject({
      name: "mx",
      prefix4: 24,
    });
  });

  it("rejects a prefix that is out of range", () => {
    expect(reject("v=spf1 a:example.com/33 -all")).toContain("IPv4 prefix");
    expect(reject("v=spf1 a:example.com//129 -all")).toContain("IPv6 prefix");
  });
});

describe("ptr", () => {
  it("parses, so it can be reported rather than rejected", () => {
    // RFC 7208 §5.5 discourages publishing it; it is still valid syntax, and
    // treating it as a syntax error would report the wrong problem.
    expect(parse("v=spf1 ptr -all").terms[0]).toMatchObject({ name: "ptr" });
  });

  it("takes no CIDR length", () => {
    expect(reject("v=spf1 ptr/24 -all")).toContain("no CIDR length");
  });
});

describe("modifiers", () => {
  it("reads redirect and exp", () => {
    const record = parse("v=spf1 redirect=other.example exp=why.example");

    expect(record.redirect).toBe("other.example");
    expect(record.exp).toBe("why.example");
  });

  it("keeps unknown modifiers rather than rejecting them", () => {
    // RFC 7208 §6 requires unrecognised modifiers to be ignored, so a record
    // carrying one is still a valid record.
    const record = parse("v=spf1 futuremod=whatever -all");

    expect(record.terms[0]).toMatchObject({ kind: "modifier" });
  });

  it("rejects a second redirect or exp", () => {
    // Two have no defined precedence, so the record cannot be evaluated at all.
    expect(reject("v=spf1 redirect=a.example redirect=b.example")).toContain(
      "more than once"
    );
    expect(reject("v=spf1 exp=a.example exp=b.example -all")).toContain(
      "more than once"
    );
  });

  it("does not mistake a colon-bearing mechanism for a modifier", () => {
    // `=` after a `:` belongs to the domain-spec. Reading this as a modifier
    // would turn a valid record into a syntax error.
    const record = parse("v=spf1 include:a=b.example -all");

    expect(record.terms[0]).toMatchObject({
      kind: "mechanism",
      name: "include",
      value: "a=b.example",
    });
  });
});

describe("rejections", () => {
  it("rejects a record that does not start with the version", () => {
    expect(reject("include:example.com -all")).toContain("v=spf1");
  });

  it("rejects an unknown mechanism", () => {
    expect(reject("v=spf1 includes:example.com -all")).toContain(
      "not an SPF mechanism"
    );
  });

  it("rejects include and exists with no domain", () => {
    expect(reject("v=spf1 include: -all")).toContain("needs a domain");
    expect(reject("v=spf1 exists -all")).toContain("needs a domain");
  });

  it("rejects an argument on all", () => {
    expect(reject("v=spf1 all:example.com")).toContain("no argument");
  });
});

describe("countsAsLookup", () => {
  it("counts the six terms that query DNS", () => {
    const record = parse(
      "v=spf1 include:a.example a mx ptr exists:b.example redirect=c.example"
    );

    expect(record.terms.filter(countsAsLookup)).toHaveLength(6);
  });

  it("does not count ip4, ip6, all, or exp", () => {
    // exp is fetched only to build a rejection message, after the outcome is
    // already decided, so it is outside the ten.
    const record = parse(
      "v=spf1 ip4:198.51.100.0/24 ip6:2001:db8::/32 exp=why.example -all"
    );

    expect(record.terms.filter(countsAsLookup)).toHaveLength(0);
    expect(directLookupCost(record)).toBe(0);
  });
});

describe("containsMacro", () => {
  it("spots a macro anywhere in a domain-spec", () => {
    expect(containsMacro("%{i}._spf.example.com")).toBe(true);
    expect(containsMacro("_spf.example.com")).toBe(false);
    // A literal percent is not a macro.
    expect(containsMacro("100%.example.com")).toBe(false);
  });
});

describe("whitespace", () => {
  it("tolerates runs of spaces and surrounding padding", () => {
    const record = parse("  v=spf1   ip4:198.51.100.1    -all  ");

    expect(record.terms).toHaveLength(2);
  });

  it("keeps only the first all, which is the only one that can match", () => {
    const record = parse("v=spf1 -all +all");

    expect(record.all?.qualifier).toBe("-");
    expect(record.terms).toHaveLength(2);
  });
});
