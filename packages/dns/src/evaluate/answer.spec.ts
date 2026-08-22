import { describe, expect, it } from "vitest";
import { ttlsDisagree } from "./answer";

describe("ttlsDisagree", () => {
  it("is false for a set that agrees", () => {
    expect(ttlsDisagree([{ ttl: 300 }, { ttl: 300 }, { ttl: 300 }])).toBe(
      false
    );
  });

  it("is true when one record differs", () => {
    expect(ttlsDisagree([{ ttl: 300 }, { ttl: 60 }])).toBe(true);
  });

  it("says nothing about a set too small to disagree", () => {
    expect(ttlsDisagree([])).toBe(false);
    expect(ttlsDisagree([{ ttl: 300 }])).toBe(false);
  });
});
