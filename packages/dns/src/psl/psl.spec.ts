import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PSL_UPSTREAM_COMMIT } from "./data";
import { getPublicSuffix, getRegistrableDomain, isPublicSuffix } from "./index";

/**
 * The PSL project publishes its own test vectors, so this suite runs those rather
 * than a set I invented. Cases I chose would test my understanding of the
 * algorithm; theirs test the algorithm.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const VECTOR = /^checkPublicSuffix\((.+)\);$/;
const QUOTED = /^'(.*)'$/;
const SHA1_HEX = /^[0-9a-f]{40}$/;

interface Vector {
  readonly expected: string | null;
  readonly input: string | null;
  readonly line: number;
}

function parseArgument(raw: string): string | null {
  const trimmed = raw.trim();

  if (trimmed === "null") {
    return null;
  }

  const quoted = trimmed.match(QUOTED);

  if (!quoted) {
    throw new Error(`unparseable argument: ${raw}`);
  }

  return quoted[1] ?? null;
}

function loadVectors(): Vector[] {
  const text = readFileSync(join(HERE, "vendor", "test_psl.txt"), "utf8");
  const vectors: Vector[] = [];

  for (const [index, line] of text.split("\n").entries()) {
    const match = line.trim().match(VECTOR);

    if (!match?.[1]) {
      continue;
    }

    // Arguments are simple enough that splitting on the comma is safe: no
    // argument in the file contains one.
    const [inputRaw, expectedRaw] = match[1].split(",");

    if (inputRaw === undefined || expectedRaw === undefined) {
      throw new Error(`unparseable vector on line ${index + 1}: ${line}`);
    }

    vectors.push({
      expected: parseArgument(expectedRaw),
      input: parseArgument(inputRaw),
      line: index + 1,
    });
  }

  return vectors;
}

const vectors = loadVectors();

describe("publicsuffix.org test vectors", () => {
  it("parses a plausible number of vectors, so a parser bug cannot make this vacuous", () => {
    expect(vectors.length).toBeGreaterThan(70);
  });

  // `checkPublicSuffix(input, expected)` asserts the *registrable* domain, which
  // is the PSL+1 value DMARC needs — not the public suffix, despite the name.
  for (const { input, expected, line } of vectors) {
    it(`line ${line}: ${String(input)} -> ${String(expected)}`, () => {
      // The vectors assume the full list, private section included.
      expect(getRegistrableDomain(input ?? "")).toBe(expected);
    });
  }
});

describe("getPublicSuffix", () => {
  it("handles a multi-label ICANN suffix", () => {
    expect(getPublicSuffix("www.example.co.uk")).toBe("co.uk");
  });

  it("applies a wildcard rule", () => {
    // *.ck means every label under ck is a suffix.
    expect(getPublicSuffix("foo.ck")).toBe("foo.ck");
    expect(getPublicSuffix("bar.foo.ck")).toBe("foo.ck");
  });

  it("applies an exception rule, which beats the wildcard covering it", () => {
    // !www.ck carves www.ck out of *.ck, so the suffix drops back to ck.
    expect(getPublicSuffix("www.ck")).toBe("ck");
    expect(getPublicSuffix("anything.www.ck")).toBe("ck");
  });

  it("falls back to the implicit * rule for an unlisted TLD", () => {
    expect(getPublicSuffix("example.nonexistent-tld-xyz")).toBe(
      "nonexistent-tld-xyz"
    );
  });

  it("normalises case and a trailing dot", () => {
    expect(getPublicSuffix("WWW.EXAMPLE.CO.UK.")).toBe("co.uk");
  });

  it("matches unicode via punycode but answers in the input's form", () => {
    // Matching happens in ASCII against the punycoded rules; the result is
    // sliced from the caller's own labels, so they get their domain back rather
    // than its punycode. The PSL's own vectors require this.
    expect(getPublicSuffix("例え.日本")).toBe("日本");
    expect(getPublicSuffix("xn--r8jz45g.xn--wgv71a")).toBe("xn--wgv71a");
  });

  it("rejects malformed input rather than repairing it", () => {
    expect(getPublicSuffix("")).toBeNull();
    expect(getPublicSuffix(".com")).toBeNull();
    expect(getPublicSuffix("a..b")).toBeNull();
  });
});

describe("getRegistrableDomain", () => {
  it("returns null when nothing is registrable under the suffix", () => {
    expect(getRegistrableDomain("com")).toBeNull();
    expect(getRegistrableDomain("co.uk")).toBeNull();
    // Under *.ck, "foo.ck" is itself a suffix.
    expect(getRegistrableDomain("foo.ck")).toBeNull();
  });

  it("is what DMARC needs: the org domain, not the queried name", () => {
    // A resolver reading _dmarc at the queried name finds nothing here and would
    // report an unprotected domain that is in fact protected.
    expect(getRegistrableDomain("sub.example.co.uk")).toBe("example.co.uk");
    expect(getRegistrableDomain("deep.sub.example.co.uk")).toBe(
      "example.co.uk"
    );
  });
});

describe("the ICANN / PRIVATE section split", () => {
  it("treats github.io as a suffix by default, so siblings are separate orgs", () => {
    expect(getRegistrableDomain("user.github.io")).toBe("user.github.io");
    expect(getRegistrableDomain("pages.user.github.io")).toBe("user.github.io");
    expect(isPublicSuffix("github.io")).toBe(true);
  });

  it("collapses github.io to io when private rules are excluded", () => {
    // Same input, different answer. This is why the flag is documented rather
    // than merely defaulted: it changes who is considered to control a name.
    expect(
      getRegistrableDomain("user.github.io", { includePrivate: false })
    ).toBe("github.io");
    expect(isPublicSuffix("github.io", { includePrivate: false })).toBe(false);
  });

  it("agrees on ICANN suffixes either way", () => {
    for (const options of [undefined, { includePrivate: false }]) {
      expect(getRegistrableDomain("sub.example.co.uk", options)).toBe(
        "example.co.uk"
      );
    }
  });
});

describe("isPublicSuffix", () => {
  it("is true for a suffix and false for a name under one", () => {
    expect(isPublicSuffix("co.uk")).toBe(true);
    expect(isPublicSuffix("com")).toBe(true);
    expect(isPublicSuffix("example.co.uk")).toBe(false);
  });

  it("is false for malformed input", () => {
    expect(isPublicSuffix(".com")).toBe(false);
  });
});

describe("vendored data", () => {
  it("records the upstream commit it was generated from", () => {
    // The receipt: any version of data.ts can be regenerated exactly.
    expect(PSL_UPSTREAM_COMMIT).toMatch(SHA1_HEX);
  });
});
