import { describe, expect, it } from "vitest";
import { ttlsDisagree } from "./answer";

/**
 * The TTL comparison is unit-tested rather than fixture-tested because the
 * condition cannot be put in a zone file: `named-checkzone` rewrites a
 * mismatched TTL to the first one it saw and `nsd-checkzone` warns, so a
 * fixture would be normalised before it was ever served.
 */

describe("ttlsDisagree", () => {
  it("is false for a set that agrees", () => {
    expect(ttlsDisagree([{ ttl: 300 }, { ttl: 300 }, { ttl: 300 }])).toBe(
      false
    );
  });

  it("is true when one record differs", () => {
    // RFC 2181 §5.2. Part of the set expires before the rest, so the answer
    // changes shape with nothing having been edited.
    expect(ttlsDisagree([{ ttl: 300 }, { ttl: 60 }])).toBe(true);
  });

  it("says nothing about a set too small to disagree", () => {
    expect(ttlsDisagree([])).toBe(false);
    expect(ttlsDisagree([{ ttl: 300 }])).toBe(false);
  });
});
