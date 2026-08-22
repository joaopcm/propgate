export const MAX_LABEL_LENGTH = 63;

export const MAX_NAME_LENGTH = 255;

export const MAX_CHARACTER_STRING_LENGTH = 255;

export const CLASSIC_UDP_LIMIT = 512;

export const COMPRESSION_POINTER_MASK = 0xc0;
export const COMPRESSION_OFFSET_MASK = 0x3f_ff;

export const HEADER_LENGTH = 12;

export const RecordType = {
  A: 1,
  AAAA: 28,
  ANY: 255,
  CAA: 257,
  CNAME: 5,
  DNSKEY: 48,
  DS: 43,
  MX: 15,
  NS: 2,
  NSEC: 47,
  NSEC3: 50,
  OPT: 41,
  PTR: 12,
  RRSIG: 46,
  SOA: 6,
  TXT: 16,
} as const;

export type RecordTypeName = keyof typeof RecordType;
export type RecordTypeValue = (typeof RecordType)[RecordTypeName];

export const RECORD_TYPE_NAMES: Readonly<Record<number, RecordTypeName>> =
  Object.fromEntries(
    Object.entries(RecordType).map(([name, value]) => [value, name])
  ) as Record<number, RecordTypeName>;

export const RecordClass = {
  ANY: 255,
  CH: 3,
  IN: 1,
  NONE: 254,
} as const;

export type RecordClassValue = (typeof RecordClass)[keyof typeof RecordClass];

export const Rcode = {
  BADVERS: 16,
  FORMERR: 1,
  NOERROR: 0,
  NOTIMP: 4,
  NXDOMAIN: 3,
  REFUSED: 5,
  SERVFAIL: 2,
} as const;

export type RcodeValue = number;

export const RCODE_NAMES: Readonly<Record<number, string>> = {
  0: "NOERROR",
  1: "FORMERR",
  2: "SERVFAIL",
  3: "NXDOMAIN",
  4: "NOTIMP",
  5: "REFUSED",
  16: "BADVERS",
};

export function rcodeName(rcode: number): string {
  return RCODE_NAMES[rcode] ?? `RCODE${rcode}`;
}

export const DNSSEC_ALGORITHM_NAMES: Readonly<Record<number, string>> = {
  5: "RSASHA1",
  7: "RSASHA1-NSEC3-SHA1",
  8: "RSASHA256",
  10: "RSASHA512",
  13: "ECDSAP256SHA256",
  14: "ECDSAP384SHA384",
  15: "ED25519",
  16: "ED448",
};
