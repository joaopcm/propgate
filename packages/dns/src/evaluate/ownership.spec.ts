import { describe, expect, it } from "vitest";
import { nearMissFor, ownershipRecordName } from "./ownership";

const TOKEN = "propgate-verify=6c1f9a24b7e5d03812af49b6c5d0e7f3";

describe("the record name", () => {
  it("puts the token at the label", () => {
    expect(
      ownershipRecordName({ domain: "example.com", label: "_pg", token: TOKEN })
    ).toBe("_pg.example.com");
  });

  it("puts it at the apex when no label was given", () => {
    expect(ownershipRecordName({ domain: "example.com", token: TOKEN })).toBe(
      "example.com"
    );
  });

  it("treats an empty label as the apex rather than as a leading dot", () => {
    expect(
      ownershipRecordName({ domain: "example.com", label: "", token: TOKEN })
    ).toBe("example.com");
  });
});

describe("near misses", () => {
  it("finds nothing when nothing resembles the token", () => {
    expect(nearMissFor(TOKEN, ["v=spf1 -all", "unrelated"])).toBeUndefined();
  });

  it("finds nothing in an empty set", () => {
    expect(nearMissFor(TOKEN, [])).toBeUndefined();
  });

  it("names stored quotes", () => {
    const near = nearMissFor(TOKEN, [`"${TOKEN}"`]);

    expect(near?.detail).toContain("quotes");
    expect(near?.mangled).toBe(false);
  });

  it("names a whitespace rejoin, and marks it as storage rather than content", () => {
    const near = nearMissFor(TOKEN, [
      "propgate-verify=6c1f9a24b7e5d03 812af49b6c5d0e7f3",
    ]);

    expect(near?.mangled).toBe(true);
  });

  it("names letter case", () => {
    expect(nearMissFor(TOKEN, [TOKEN.toUpperCase()])?.detail).toContain(
      "letter case"
    );
  });

  it("counts what survived a truncating field", () => {
    const near = nearMissFor(TOKEN, [TOKEN.slice(0, 30)]);

    expect(near?.detail).toContain("first 30");
    expect(near?.detail).toContain(`${TOKEN.length}`);
  });

  it("does not call an empty record a truncation", () => {
    expect(nearMissFor(TOKEN, [""])).toBeUndefined();
  });

  it("does not call the token itself a near miss", () => {
    expect(nearMissFor(TOKEN, [TOKEN])).toBeUndefined();
  });

  it("looks past values that are simply unrelated", () => {
    expect(
      nearMissFor(TOKEN, [
        "v=spf1 -all",
        "google-site-verification=x",
        `"${TOKEN}"`,
      ])?.detail
    ).toContain("quotes");
  });
});
