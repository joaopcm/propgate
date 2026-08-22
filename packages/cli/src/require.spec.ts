import { describe, expect, it } from "vitest";
import { parseRequirement, parseRequirements } from "./require";

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

  it("insists dkim names a selector", () => {
    expect(parseRequirement("k1:dkim")).toContain("dkim needs a selector");
  });

  it("insists caa names an issuer", () => {
    expect(parseRequirement("ca:caa")).toContain("caa needs an issuer");
  });

  it("leaves the rest to the API", () => {
    const parsed = parseRequirements(["a:spf", "a:spf"]);

    expect(Array.isArray(parsed)).toBe(true);
  });
});

describe("every field the parser accepts reaches the requirement", () => {
  it("carries a label through, which is what puts a check on a bounce host", () => {
    expect(
      parseRequirement("bounce:spf:include=amazonses.com,label=send")
    ).toEqual({
      check: "spf",
      include: "amazonses.com",
      key: "bounce",
      label: "send",
    });
  });

  it("carries a cname target and an ownership token through", () => {
    expect(
      parseRequirement("track:cname:label=track,target=t.propgate.dev")
    ).toEqual({
      check: "cname",
      key: "track",
      label: "track",
      target: "t.propgate.dev",
    });
    expect(parseRequirement("own:ownership:token=abc123")).toEqual({
      check: "ownership",
      key: "own",
      token: "abc123",
    });
  });

  it("keeps a label alongside a boolean, which parse separately", () => {
    expect(parseRequirement("bounce:mx:expectsMail=true,label=send")).toEqual({
      check: "mx",
      expectsMail: true,
      key: "bounce",
      label: "send",
    });
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
