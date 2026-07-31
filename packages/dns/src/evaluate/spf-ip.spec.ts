import { describe, expect, it } from "vitest";
import { cidrContains, fullPrefix, parseIpAddress } from "./spf-ip";

/** Address arithmetic is pure. Matching against real records is in the fixture spec. */

function ip(text: string) {
  const address = parseIpAddress(text);

  if (address === null) {
    throw new Error(`expected "${text}" to parse`);
  }

  return address;
}

function contains(network: string, prefix: number, address: string): boolean {
  return cidrContains(ip(network), prefix, ip(address));
}

describe("parseIpAddress", () => {
  it("reads IPv4 as four bytes", () => {
    expect([...ip("198.51.100.1").bytes]).toEqual([198, 51, 100, 1]);
    expect(ip("198.51.100.1").family).toBe("ipv4");
  });

  it("reads a full IPv6 as sixteen bytes", () => {
    expect([...ip("2001:0db8:0000:0000:0000:0000:0000:0001").bytes]).toEqual([
      0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ]);
  });

  it("expands :: from either end and from the middle", () => {
    expect(ip("2001:db8::1").bytes).toEqual(
      ip("2001:0db8:0000:0000:0000:0000:0000:0001").bytes
    );
    expect(ip("::1").bytes).toEqual(
      ip("0000:0000:0000:0000:0000:0000:0000:0001").bytes
    );
    expect(ip("2001:db8::").bytes).toEqual(
      ip("2001:0db8:0000:0000:0000:0000:0000:0000").bytes
    );
    expect(ip("::").bytes).toEqual(new Uint8Array(16));
  });

  it("reads an embedded dotted quad", () => {
    expect([...ip("2001:db8::198.51.100.1").bytes].slice(12)).toEqual([
      198, 51, 100, 1,
    ]);
  });

  it("returns an IPv4-mapped address as IPv4", () => {
    // A client that connected over IPv4 is routinely reported as ::ffff:… by a
    // dual-stack MTA. Keeping the mapped form would mean no ip4 mechanism could
    // ever match it, and the domain would be told its record does not authorise
    // a host that it plainly does.
    const mapped = ip("::ffff:198.51.100.1");

    expect(mapped.family).toBe("ipv4");
    expect([...mapped.bytes]).toEqual([198, 51, 100, 1]);
    // The text is kept verbatim, so evidence shows what the sender presented.
    expect(mapped.text).toBe("::ffff:198.51.100.1");
  });

  it("rejects anything that is not an address", () => {
    expect(parseIpAddress("198.51.100.999")).toBeNull();
    expect(parseIpAddress("example.com")).toBeNull();
    expect(parseIpAddress("")).toBeNull();
    expect(parseIpAddress("2001:db8::1::2")).toBeNull();
  });
});

describe("cidrContains on IPv4", () => {
  it("matches inside a /24 and not outside it", () => {
    expect(contains("198.51.100.0", 24, "198.51.100.1")).toBe(true);
    expect(contains("198.51.100.0", 24, "198.51.100.255")).toBe(true);
    expect(contains("198.51.100.0", 24, "198.51.101.1")).toBe(false);
  });

  it("handles a prefix that does not land on a byte boundary", () => {
    // /25 splits the last byte, which is where an implementation that only
    // compares whole bytes silently authorises twice the intended range.
    expect(contains("198.51.100.0", 25, "198.51.100.127")).toBe(true);
    expect(contains("198.51.100.0", 25, "198.51.100.128")).toBe(false);
    expect(contains("198.51.100.128", 25, "198.51.100.128")).toBe(true);
  });

  it("treats /32 as a single host and /0 as everything", () => {
    expect(contains("198.51.100.1", 32, "198.51.100.1")).toBe(true);
    expect(contains("198.51.100.1", 32, "198.51.100.2")).toBe(false);
    expect(contains("198.51.100.1", 0, "203.0.113.9")).toBe(true);
  });
});

describe("cidrContains on IPv6", () => {
  it("matches inside a /32", () => {
    expect(contains("2001:db8::", 32, "2001:db8:1234::1")).toBe(true);
    expect(contains("2001:db8::", 32, "2001:db9::1")).toBe(false);
  });

  it("handles a prefix inside a group", () => {
    expect(contains("2001:db8::", 33, "2001:db8:7fff::1")).toBe(true);
    expect(contains("2001:db8::", 33, "2001:db8:8000::1")).toBe(false);
  });

  it("treats /128 as a single host", () => {
    expect(contains("2001:db8::1", 128, "2001:db8::1")).toBe(true);
    expect(contains("2001:db8::1", 128, "2001:db8::2")).toBe(false);
  });
});

describe("families never cross", () => {
  it("does not match an IPv6 client against an IPv4 network, or the reverse", () => {
    // RFC 7208 §5.6. Comparing the four bytes of an IPv4 network against the
    // first four of an IPv6 address would authorise unrelated hosts.
    expect(contains("198.51.100.0", 24, "2001:db8::1")).toBe(false);
    expect(contains("2001:db8::", 32, "198.51.100.1")).toBe(false);
    // Even /0, which otherwise matches everything.
    expect(contains("2001:db8::", 0, "198.51.100.1")).toBe(false);
  });

  it("matches a mapped client against an IPv4 network", () => {
    expect(contains("198.51.100.0", 24, "::ffff:198.51.100.5")).toBe(true);
  });
});

describe("fullPrefix", () => {
  it("is the whole address for each family", () => {
    expect(fullPrefix("ipv4")).toBe(32);
    expect(fullPrefix("ipv6")).toBe(128);
  });
});
