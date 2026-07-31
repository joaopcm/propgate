import { isIPv4, isIPv6 } from "node:net";

/**
 * Address arithmetic for SPF matching (RFC 7208 §5.6).
 *
 * Hand-rolled because `@propgate/dns` has no runtime dependencies, and because
 * the two things a CIDR library would give us — parsing and containment — are
 * about sixty lines between them. Node's `isIPv4` / `isIPv6` do the validating,
 * so everything below can assume well-formed input and stay readable.
 *
 * Addresses are compared as bytes rather than as numbers. A /24 over a 32-bit
 * integer works until someone writes an IPv6 prefix, and the shift that breaks
 * is `1 << 32`, which in JavaScript is 1 rather than an error.
 */

const IPV4_BYTES = 4;
const IPV6_BYTES = 16;
const IPV6_GROUPS = 8;
const BITS_PER_BYTE = 8;

/** The ::ffff:0:0/96 prefix, in bytes. */
const V4_MAPPED_PREFIX = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff] as const;

export type IpFamily = "ipv4" | "ipv6";

export interface IpAddress {
  /** 4 bytes for IPv4, 16 for IPv6. */
  readonly bytes: Uint8Array;
  readonly family: IpFamily;
  /** The text this was parsed from, unchanged. */
  readonly text: string;
}

function parseIpv4(text: string): Uint8Array {
  const bytes = new Uint8Array(IPV4_BYTES);
  const parts = text.split(".");

  for (let index = 0; index < IPV4_BYTES; index += 1) {
    bytes[index] = Number(parts[index]);
  }

  return bytes;
}

function writeGroup(bytes: Uint8Array, offset: number, group: string): void {
  const value = Number.parseInt(group, 16);

  bytes[offset] = (value >> BITS_PER_BYTE) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

/** Split an IPv6 text into its groups, expanding a trailing dotted quad. */
function groupsOf(text: string): string[] {
  const groups = text.split(":");
  const last = groups.at(-1) ?? "";

  if (!last.includes(".")) {
    return groups;
  }

  // ::ffff:198.51.100.1 — the tail is an IPv4 literal occupying two groups.
  const quad = parseIpv4(last);

  return [
    ...groups.slice(0, -1),
    (((quad[0] ?? 0) << BITS_PER_BYTE) | (quad[1] ?? 0)).toString(16),
    (((quad[2] ?? 0) << BITS_PER_BYTE) | (quad[3] ?? 0)).toString(16),
  ];
}

function parseIpv6(text: string): Uint8Array {
  const bytes = new Uint8Array(IPV6_BYTES);
  const [head, tail] = text.split("::");

  if (tail === undefined) {
    const groups = groupsOf(text);

    for (let index = 0; index < IPV6_GROUPS; index += 1) {
      writeGroup(bytes, index * 2, groups[index] ?? "0");
    }

    return bytes;
  }

  // "::" stands for as many zero groups as it takes to reach eight. The bytes
  // are already zero, so only the ends need writing.
  const left = head === undefined || head === "" ? [] : groupsOf(head);
  const right = tail === "" ? [] : groupsOf(tail);

  for (const [index, group] of left.entries()) {
    writeGroup(bytes, index * 2, group);
  }

  for (const [index, group] of right.entries()) {
    writeGroup(bytes, IPV6_BYTES - (right.length - index) * 2, group);
  }

  return bytes;
}

function isV4Mapped(bytes: Uint8Array): boolean {
  return V4_MAPPED_PREFIX.every((byte, index) => bytes[index] === byte);
}

/**
 * Parse an address, or null if it is not one.
 *
 * An IPv4-mapped IPv6 address is returned as IPv4. A client that connected over
 * IPv4 is routinely reported as `::ffff:198.51.100.1` by a dual-stack MTA, and
 * §5.6 has `ip4` matching only IPv4 clients — so keeping the mapped form would
 * mean no `ip4` mechanism could ever match it, and the domain would be told its
 * record does not authorise a host that it plainly does.
 */
export function parseIpAddress(text: string): IpAddress | null {
  const trimmed = text.trim();

  if (isIPv4(trimmed)) {
    return { bytes: parseIpv4(trimmed), family: "ipv4", text: trimmed };
  }

  if (!isIPv6(trimmed)) {
    return null;
  }

  const bytes = parseIpv6(trimmed);

  if (isV4Mapped(bytes)) {
    return {
      bytes: bytes.slice(V4_MAPPED_PREFIX.length),
      family: "ipv4",
      text: trimmed,
    };
  }

  return { bytes, family: "ipv6", text: trimmed };
}

/**
 * Whether `address` falls inside `network`/`prefix`.
 *
 * Families must match: an `ip4` mechanism never matches an IPv6 client, and the
 * reverse, per §5.6.
 */
export function cidrContains(
  network: IpAddress,
  prefix: number,
  address: IpAddress
): boolean {
  if (network.family !== address.family) {
    return false;
  }

  const wholeBytes = Math.floor(prefix / BITS_PER_BYTE);
  const remainingBits = prefix % BITS_PER_BYTE;

  for (let index = 0; index < wholeBytes; index += 1) {
    if (network.bytes[index] !== address.bytes[index]) {
      return false;
    }
  }

  if (remainingBits === 0) {
    return true;
  }

  // The high `remainingBits` of the next byte, and nothing below them.
  const mask = (0xff << (BITS_PER_BYTE - remainingBits)) & 0xff;

  return (
    ((network.bytes[wholeBytes] ?? 0) & mask) ===
    ((address.bytes[wholeBytes] ?? 0) & mask)
  );
}

/** The default prefix for a family, used when a mechanism writes none. */
export function fullPrefix(family: IpFamily): number {
  return family === "ipv4"
    ? IPV4_BYTES * BITS_PER_BYTE
    : IPV6_BYTES * BITS_PER_BYTE;
}
