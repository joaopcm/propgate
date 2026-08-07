import { describe, expect, it } from "vitest";
import { anyExpectations, parseExpectations } from "./expect";

describe("parseExpectations", () => {
  it("reads a requirement, a field and a value", () => {
    expect(parseExpectations(["dkim.expectedPublicKey=MIGf"])).toEqual({
      dkim: { expectedPublicKey: "MIGf" },
    });
  });

  it("groups several fields under one requirement", () => {
    expect(
      parseExpectations(["dkim.selector=acme-1", "dkim.expectedPublicKey=MIGf"])
    ).toEqual({ dkim: { expectedPublicKey: "MIGf", selector: "acme-1" } });
  });

  it("keeps the base64 padding on a DKIM key", () => {
    // The value this flag exists for ends in `=` or `==`. Splitting on every
    // equals sign would truncate exactly the key it was added to carry, and a key
    // that lost its padding is a key that silently fails to match.
    expect(parseExpectations(["dkim.expectedPublicKey=MIGfMA0GCSq=="])).toEqual({
      dkim: { expectedPublicKey: "MIGfMA0GCSq==" },
    });
  });

  it("takes the last dot, so a dotted requirement key survives", () => {
    // No field name contains a dot; a requirement key may.
    expect(parseExpectations(["mail.dkim.selector=acme-1"])).toEqual({
      "mail.dkim": { selector: "acme-1" },
    });
  });

  it("refuses an entry with no field", () => {
    expect(parseExpectations(["dkim=MIGf"])).toContain(
      "needs a requirement and a field"
    );
  });

  it("refuses an entry with no value", () => {
    expect(parseExpectations(["dkim.selector="])).toContain("needs a value");
  });

  it("refuses an entry that is not an assignment", () => {
    expect(parseExpectations(["dkim.selector"])).toContain(
      "is not <requirement>.<field>=<value>"
    );
  });

  it("refuses the same field twice rather than picking one", () => {
    expect(
      parseExpectations([
        "dkim.expectedPublicKey=one",
        "dkim.expectedPublicKey=two",
      ])
    ).toContain("was given twice");
  });

  it("is empty for no input, which is not an error", () => {
    // A profile that requires nothing per domain needs nothing here, and the
    // server is the one that knows which profiles those are.
    const parsed = parseExpectations([]);

    expect(parsed).toEqual({});
    expect(anyExpectations(parsed as Record<string, never>)).toBe(false);
  });
});
