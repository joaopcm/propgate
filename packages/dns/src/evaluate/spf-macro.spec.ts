import { describe, expect, it } from "vitest";
import { parseIpAddress } from "./spf-ip";
import type { MacroContext } from "./spf-macro";
import { expandMacros, validateMacroString } from "./spf-macro";

function rfcContext(overrides: Partial<MacroContext> = {}): MacroContext {
  return {
    domain: "email.example.com",
    helo: "email.example.com",
    ip: parseIpAddress("192.0.2.3") ?? undefined,
    sender: "strong-bad@email.example.com",
    ...overrides,
  };
}

function expand(raw: string, context: MacroContext = rfcContext()): string {
  const result = expandMacros(raw, context);

  if (!result.ok) {
    throw new Error(`expected "${raw}" to expand: ${result.detail}`);
  }

  return result.value;
}

function refuse(raw: string, context: MacroContext = rfcContext()) {
  const result = expandMacros(raw, context);

  if (result.ok) {
    throw new Error(`expected "${raw}" to be refused, got "${result.value}"`);
  }

  return result;
}

describe("the worked examples from RFC 7208 §7.4", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["%{s}", "strong-bad@email.example.com"],
    ["%{o}", "email.example.com"],
    ["%{d}", "email.example.com"],
    ["%{d4}", "email.example.com"],
    ["%{d3}", "email.example.com"],
    ["%{d2}", "example.com"],
    ["%{d1}", "com"],
    ["%{dr}", "com.example.email"],
    ["%{d2r}", "example.email"],
    ["%{l}", "strong-bad"],
    ["%{l-}", "strong.bad"],
    ["%{lr}", "strong-bad"],
    ["%{lr-}", "bad.strong"],
    ["%{l1r-}", "strong"],
  ];

  for (const [macro, expected] of cases) {
    it(`expands ${macro} to ${expected}`, () => {
      expect(expand(macro)).toBe(expected);
    });
  }

  it("builds the section's full example names", () => {
    expect(expand("%{ir}.%{v}._spf.%{d2}")).toBe(
      "3.2.0.192.in-addr._spf.example.com"
    );
    expect(expand("%{lr-}.lp._spf.%{d2}")).toBe(
      "bad.strong.lp._spf.example.com"
    );
    expect(expand("%{lr-}.lp.%{ir}.%{v}._spf.%{d2}")).toBe(
      "bad.strong.lp.3.2.0.192.in-addr._spf.example.com"
    );
    expect(expand("%{ir}.%{v}.%{l1r-}.lp._spf.%{d2}")).toBe(
      "3.2.0.192.in-addr.strong.lp._spf.example.com"
    );
    expect(expand("%{d2}.trusted-domains.example.net")).toBe(
      "example.com.trusted-domains.example.net"
    );
  });
});

describe("IPv6", () => {
  const ipv6 = rfcContext({
    ip: parseIpAddress("2001:db8::cb01") ?? undefined,
  });

  it("expands %{ir} to reversed nibbles", () => {
    expect(expand("%{ir}.%{v}._spf.%{d2}", ipv6)).toBe(
      "1.0.b.c.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6._spf.example.com"
    );
  });

  it("uses ip6 rather than in-addr for %{v}", () => {
    expect(expand("%{v}", ipv6)).toBe("ip6");
  });
});

describe("transformer order", () => {
  it("reverses before taking the rightmost parts", () => {
    expect(expand("%{d2r}")).toBe("example.email");
  });

  it("splits on every delimiter in the set, and on nothing else", () => {
    expect(expand("%{s+-}", rfcContext({ sender: "a+b-c@example.com" }))).toBe(
      "a.b.c@example.com"
    );
  });

  it("keeps the whole value when the count exceeds the parts", () => {
    expect(expand("%{d9}")).toBe("email.example.com");
  });
});

describe("literals and escapes", () => {
  it("passes ordinary text through", () => {
    expect(expand("_spf.%{d}")).toBe("_spf.email.example.com");
  });

  it("handles %%, %_ and %-", () => {
    expect(expand("%%")).toBe("%");
    expect(expand("a%_b")).toBe("a b");
    expect(expand("a%-b")).toBe("a%20b");
  });

  it("URL-escapes an uppercase macro", () => {
    expect(expand("%{S}")).toBe("strong-bad%40email.example.com");
  });
});

describe("bounces", () => {
  it("substitutes postmaster@<helo> when there is no envelope sender", () => {
    const bounce = rfcContext({ sender: undefined });

    expect(expand("%{l}", bounce)).toBe("postmaster");
    expect(expand("%{s}", bounce)).toBe("postmaster@email.example.com");
  });
});

describe("refusals", () => {
  it("calls a malformed macro a syntax error", () => {
    expect(refuse("%{").reason).toBe("syntax");
    expect(refuse("%{d").reason).toBe("syntax");
    expect(refuse("%q").reason).toBe("syntax");
    expect(refuse("%{d0}").reason).toBe("syntax");
  });

  it("rejects an exp-only macro letter in a domain-spec", () => {
    for (const letter of ["c", "r", "t"]) {
      expect(refuse(`%{${letter}}`).detail).toContain("exp=");
    }
  });

  it("calls a missing input unsupported, not a syntax error", () => {
    const noIp = rfcContext({ ip: undefined });

    expect(refuse("%{i}", noIp).reason).toBe("unsupported");
    expect(refuse("%{v}", noIp).reason).toBe("unsupported");
  });

  it("does not attempt %{p}", () => {
    expect(refuse("%{p}").reason).toBe("unsupported");
  });
});

describe("validateMacroString", () => {
  it("passes a string with no macros at all", () => {
    expect(validateMacroString("_spf.example.com")).toBeNull();
  });

  it("passes every letter a domain-spec may use", () => {
    for (const letter of "slodiphv") {
      expect(validateMacroString(`%{${letter}}`), letter).toBeNull();
    }
  });

  it("reports the same problems the expander would", () => {
    expect(validateMacroString("%{q}")).toContain("not an SPF macro letter");
    expect(validateMacroString("%z")).toContain('"%" must be followed by');
  });

  it("accepts %{p} as syntax, which expansion still declines to answer", () => {
    expect(validateMacroString("%{p}")).toBeNull();
  });
});

describe("length", () => {
  it("drops whole labels from the left when over 253 characters", () => {
    const long = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.example.com`;
    const expanded = expand("%{d}", rfcContext({ domain: long }));

    expect(expanded.length).toBeLessThanOrEqual(253);
    expect(expanded.endsWith("example.com")).toBe(true);
    expect(expanded.startsWith("b".repeat(60))).toBe(true);
  });
});
