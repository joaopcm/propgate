import { describe, expect, it } from "vitest";
import { parse, parseResolver } from "./args";

/** Argument parsing, with no DNS anywhere near it. */

function run(...argv: string[]) {
  return parse(argv);
}

describe("parse", () => {
  it("reads a domain", () => {
    const parsed = run("check", "example.com");

    expect(parsed.kind).toBe("run");

    if (parsed.kind === "run") {
      expect(parsed.options.domain).toBe("example.com");
    }
  });

  it("shows help with no arguments", () => {
    expect(parse([]).kind).toBe("help");
    expect(run("--help").kind).toBe("help");
  });

  it("collects repeated selectors", () => {
    const parsed = run(
      "check",
      "example.com",
      "--selector",
      "a",
      "--selector",
      "b"
    );

    if (parsed.kind !== "run") {
      throw new Error("expected a run");
    }

    expect(parsed.options.selectors).toEqual(["a", "b"]);
  });

  it("leaves the mail intent unstated unless the flag is given", () => {
    // Three states, not two. Defaulting to "this domain receives mail" would
    // report every sending-only domain as broken, and defaulting the other way
    // would miss a mail domain that cannot receive anything.
    const silent = run("check", "example.com");
    const stated = run("check", "example.com", "--receives-mail");

    if (silent.kind !== "run" || stated.kind !== "run") {
      throw new Error("expected runs");
    }

    expect(silent.options.expectsMail).toBeUndefined();
    expect(stated.options.expectsMail).toBe(true);
  });

  it("rejects an unknown check", () => {
    const parsed = run("check", "example.com", "--only", "spf,whois");

    expect(parsed.kind).toBe("error");

    if (parsed.kind === "error") {
      expect(parsed.message).toContain("whois");
    }
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    // Silently ignoring a mistyped flag is how someone comes to believe they
    // ran a stricter check than they did.
    expect(run("check", "example.com", "--stritc").kind).toBe("error");
  });

  it("rejects more than one domain", () => {
    expect(run("check", "a.example.com", "b.example.com").kind).toBe("error");
  });

  it("rejects an unknown command", () => {
    expect(run("inspect", "example.com").kind).toBe("error");
  });
});

describe("parseResolver", () => {
  it("defaults the port without assuming it was written", () => {
    expect(parseResolver("1.1.1.1")).toEqual({ address: "1.1.1.1", port: 53 });
  });

  it("reads an explicit port", () => {
    expect(parseResolver("127.0.0.1:5353")).toEqual({
      address: "127.0.0.1",
      port: 5353,
    });
  });

  it("does not mistake an IPv6 address for a port", () => {
    // The colons belong to the address. Splitting on the first would send every
    // query to a port nobody wrote.
    expect(parseResolver("2001:db8::1")).toEqual({
      address: "2001:db8::1",
      port: 53,
    });
  });

  it("reads a bracketed IPv6 address with a port", () => {
    expect(parseResolver("[2001:db8::1]:5353")).toEqual({
      address: "2001:db8::1",
      port: 5353,
    });
  });

  it("rejects something that is not a port", () => {
    expect(parseResolver("1.1.1.1:0")).toContain("not a port");
    expect(parseResolver("1.1.1.1:99999")).toContain("not a port");
  });
});
