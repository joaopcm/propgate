import { describe, expect, it } from "vitest";
import type { RdataCAA } from "../wire/rdata";
import {
  decideIssuance,
  isDenyAll,
  parseCaaIssuer,
  parseCaaPolicy,
} from "./caa-record";

/** Property semantics are pure. The tree climb is in the fixture spec. */

function caa(tag: string, value: string, critical = false): RdataCAA {
  return {
    critical,
    flags: critical ? 0x80 : 0,
    kind: "CAA",
    tag,
    value,
  };
}

describe("parseCaaIssuer", () => {
  it("reads a bare CA domain", () => {
    expect(parseCaaIssuer("letsencrypt.org").domain).toBe("letsencrypt.org");
  });

  it("lowercases and trims", () => {
    expect(parseCaaIssuer("  LetsEncrypt.ORG ").domain).toBe("letsencrypt.org");
  });

  it("separates parameters from the CA name", () => {
    // Mistaking the parameters for part of the name would make every
    // account-bound policy look like it names an unknown CA.
    const issuer = parseCaaIssuer(
      "letsencrypt.org; accounturi=https://acme.test/acct/1; validationmethods=dns-01"
    );

    expect(issuer.domain).toBe("letsencrypt.org");
    expect(issuer.parameters.accounturi).toBe("https://acme.test/acct/1");
    expect(issuer.parameters.validationmethods).toBe("dns-01");
  });

  it("treats an empty issuer-domain-name as deny-all", () => {
    expect(isDenyAll(parseCaaIssuer(";"))).toBe(true);
    expect(isDenyAll(parseCaaIssuer(""))).toBe(true);
    expect(isDenyAll(parseCaaIssuer("letsencrypt.org"))).toBe(false);
  });
});

describe("parseCaaPolicy", () => {
  it("sorts properties by tag", () => {
    const policy = parseCaaPolicy([
      caa("issue", "letsencrypt.org"),
      caa("issuewild", ";"),
      caa("iodef", "mailto:a@example.com"),
    ]);

    expect(policy.issue).toHaveLength(1);
    expect(policy.issueWild).toHaveLength(1);
    expect(policy.iodef).toEqual(["mailto:a@example.com"]);
  });

  it("is case-insensitive about tags", () => {
    expect(
      parseCaaPolicy([caa("ISSUE", "letsencrypt.org")]).issue
    ).toHaveLength(1);
  });

  it("collects unknown properties only when they are critical", () => {
    const policy = parseCaaPolicy([
      caa("somethingnew", "x"),
      caa("criticalprop", "y", true),
    ]);

    // An unknown non-critical property is explicitly ignorable; a critical one
    // blocks issuance entirely.
    expect(policy.unknownCritical).toEqual(["criticalprop"]);
  });
});

describe("decideIssuance", () => {
  it("allows a listed CA", () => {
    const policy = parseCaaPolicy([caa("issue", "letsencrypt.org")]);

    expect(decideIssuance(policy, "letsencrypt.org").allowed).toBe(true);
  });

  it("rejects a CA that is not listed, and says who is", () => {
    const policy = parseCaaPolicy([
      caa("issue", "digicert.com"),
      caa("issue", "sectigo.com"),
    ]);
    const decision = decideIssuance(policy, "letsencrypt.org");

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("not-listed");
      // Naming the permitted CAs is what makes the finding actionable.
      expect(decision.permitted).toEqual(["digicert.com", "sectigo.com"]);
    }
  });

  it("rejects everything on a deny-all", () => {
    const decision = decideIssuance(parseCaaPolicy([caa("issue", ";")]), "any");

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("deny-all");
    }
  });

  it("blocks issuance on an unknown critical property, whatever else is allowed", () => {
    // RFC 8659 §4.1. The policy also names a CA, and that does not help.
    const policy = parseCaaPolicy([
      caa("issue", "letsencrypt.org"),
      caa("unknownprop", "x", true),
    ]);
    const decision = decideIssuance(policy, "letsencrypt.org");

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("unknown-critical");
    }
  });

  it("permits issuance when the RRset restricts nothing relevant", () => {
    // An iodef-only record set expresses no issuance restriction.
    const policy = parseCaaPolicy([caa("iodef", "mailto:a@example.com")]);

    expect(decideIssuance(policy, "letsencrypt.org").allowed).toBe(true);
  });
});

describe("issuewild governs wildcards exclusively", () => {
  const split = parseCaaPolicy([
    caa("issue", "letsencrypt.org"),
    caa("issuewild", "digicert.com"),
  ]);

  it("uses issuewild for a wildcard, ignoring issue", () => {
    // Merging the two would authorise letsencrypt for wildcards, which the
    // owner deliberately did not do.
    expect(
      decideIssuance(split, "digicert.com", { wildcard: true }).allowed
    ).toBe(true);
    expect(
      decideIssuance(split, "letsencrypt.org", { wildcard: true }).allowed
    ).toBe(false);
  });

  it("uses issue for an ordinary certificate, ignoring issuewild", () => {
    expect(decideIssuance(split, "letsencrypt.org").allowed).toBe(true);
    expect(decideIssuance(split, "digicert.com").allowed).toBe(false);
  });

  it("falls back to issue for wildcards when no issuewild exists", () => {
    const policy = parseCaaPolicy([caa("issue", "letsencrypt.org")]);

    expect(
      decideIssuance(policy, "letsencrypt.org", { wildcard: true }).allowed
    ).toBe(true);
  });

  it("blocks wildcards while allowing ordinary certificates", () => {
    const policy = parseCaaPolicy([
      caa("issue", "letsencrypt.org"),
      caa("issuewild", ";"),
    ]);

    expect(decideIssuance(policy, "letsencrypt.org").allowed).toBe(true);
    expect(
      decideIssuance(policy, "letsencrypt.org", { wildcard: true }).allowed
    ).toBe(false);
  });
});
