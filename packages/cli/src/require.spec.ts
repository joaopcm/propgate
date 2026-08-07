import { describe, expect, it } from "vitest";
import { parseRequirement, parseRequirements } from "./require";

/** The `--require` micro-syntax, every form and every malformed one. */

describe("parseRequirement", () => {
  it("reads a check with no fields", () => {
    expect(parseRequirement("root:delegation")).toEqual({
      check: "delegation",
      key: "root",
    });
  });

  it("reads one field", () => {
    expect(parseRequirement("mail:spf:include=_spf.resend.com")).toEqual({
      check: "spf",
      include: "_spf.resend.com",
      key: "mail",
    });
  });

  it("reads several fields", () => {
    expect(
      parseRequirement("k1:dkim:selector=resend,expectedPublicKey=MIGfMA0G")
    ).toEqual({
      check: "dkim",
      expectedPublicKey: "MIGfMA0G",
      key: "k1",
      selector: "resend",
    });
  });

  it("keeps a value that contains an equals sign", () => {
    // Base64 ends in padding, and a key that quietly lost its `==` is a key that
    // never matches for a reason nobody can see.
    const parsed = parseRequirement(
      "k1:dkim:selector=r,expectedPublicKey=AB=="
    );

    if (typeof parsed === "string") {
      throw new Error(parsed);
    }

    expect(parsed.expectedPublicKey).toBe("AB==");
  });

  it("reads the tri-state mail intent", () => {
    expect(parseRequirement("inbox:mx:expectsMail=true")).toMatchObject({
      expectsMail: true,
    });
    expect(parseRequirement("inbox:mx:expectsMail=false")).toMatchObject({
      expectsMail: false,
    });
    // Absent stays absent, which is the third state.
    expect(parseRequirement("inbox:mx")).toEqual({ check: "mx", key: "inbox" });
  });

  it("rejects an unknown check", () => {
    expect(parseRequirement("x:whois")).toContain("unknown check");
  });

  it("rejects an unknown field, and says which fields exist", () => {
    const message = parseRequirement("mail:spf:includes=x");

    expect(message).toContain('unknown requirement field "includes"');
    expect(message).toContain("include");
  });

  it("rejects a field with no value", () => {
    expect(parseRequirement("mail:spf:include")).toContain("not field=value");
    expect(parseRequirement("mail:spf:include=")).toContain("needs a value");
  });

  it("needs a key and a check", () => {
    expect(parseRequirement(":spf")).toContain("needs a key");
    expect(parseRequirement("mail")).toContain("needs a check");
  });

  /**
   * The two rules enforced here, and only these two.
   *
   * They are the same two that decide which question the guided flow asks next,
   * so knowing them on this side is not a second implementation of the server's
   * rules — it is a fact this code needs anyway.
   */
  it("insists dkim names a selector", () => {
    expect(parseRequirement("k1:dkim")).toContain("dkim needs a selector");
  });

  it("insists caa names an issuer", () => {
    expect(parseRequirement("ca:caa")).toContain("caa needs an issuer");
  });

  it("leaves the rest to the API", () => {
    // Duplicate keys, more than twenty, two of a non-repeatable kind: all valid
    // to parse and all refused by the server, whose message is the better one.
    const parsed = parseRequirements(["a:spf", "a:spf"]);

    expect(Array.isArray(parsed)).toBe(true);
  });
});

describe("parseRequirements", () => {
  it("returns the first complaint rather than a list of them", () => {
    expect(parseRequirements(["root:delegation", "x:whois"])).toContain(
      "unknown check"
    );
  });

  it("reads several", () => {
    const parsed = parseRequirements([
      "root:delegation",
      "mail:spf:include=_spf.resend.com",
    ]);

    expect(parsed).toHaveLength(2);
  });
});
