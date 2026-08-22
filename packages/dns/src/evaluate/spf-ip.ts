import { isIPv4, isIPv6 } from "node:net";

const IPV4_BYTES = 4;
const IPV6_BYTES = 16;
const IPV6_GROUPS = 8;
const BITS_PER_BYTE = 8;

const V4_MAPPED_PREFIX = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff] as const;

export type IpFamily = "ipv4" | "ipv6";

export interface IpAddress {
  readonly bytes: Uint8Array;
  readonly family: IpFamily;
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

function groupsOf(text: string): string[] {
  const groups = text.split(":");
  const last = groups.at(-1) ?? "";

  if (!last.includes(".")) {
    return groups;
  }

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

  const mask = (0xff << (BITS_PER_BYTE - remainingBits)) & 0xff;

  return (
    ((network.bytes[wholeBytes] ?? 0) & mask) ===
    ((address.bytes[wholeBytes] ?? 0) & mask)
  );
}

export function fullPrefix(family: IpFamily): number {
  return family === "ipv4"
    ? IPV4_BYTES * BITS_PER_BYTE
    : IPV6_BYTES * BITS_PER_BYTE;
}
