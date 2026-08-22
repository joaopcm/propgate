import { DNSSEC_ALGORITHM_NAMES, RecordType } from "./constants";
import { WireFormatError } from "./errors";
import type { Reader } from "./reader";

export interface RdataA {
  readonly address: string;
  readonly kind: "A";
}

export interface RdataAAAA {
  readonly address: string;
  readonly kind: "AAAA";
}

export interface RdataCNAME {
  readonly kind: "CNAME";
  readonly target: string;
}

export interface RdataNS {
  readonly kind: "NS";
  readonly target: string;
}

export interface RdataPTR {
  readonly kind: "PTR";
  readonly target: string;
}

export type RdataName = RdataCNAME | RdataNS | RdataPTR;

export interface RdataMX {
  readonly exchange: string;
  readonly isNullMx: boolean;
  readonly kind: "MX";
  readonly preference: number;
}

export interface RdataSOA {
  readonly expire: number;
  readonly hostmaster: string;
  readonly kind: "SOA";
  readonly minimum: number;
  readonly primary: string;
  readonly refresh: number;
  readonly retry: number;
  readonly serial: number;
}

export interface RdataTXT {
  readonly chunks: readonly Buffer[];
  readonly kind: "TXT";
  readonly value: string;
}

export interface RdataCAA {
  readonly critical: boolean;
  readonly flags: number;
  readonly kind: "CAA";
  readonly tag: string;
  readonly value: string;
}

export interface RdataDNSKEY {
  readonly algorithm: number;
  readonly algorithmName: string;
  readonly flags: number;
  readonly isSecureEntryPoint: boolean;
  readonly isZoneKey: boolean;
  readonly kind: "DNSKEY";
  readonly protocol: number;
  readonly publicKey: Buffer;
}

export interface RdataDS {
  readonly algorithm: number;
  readonly algorithmName: string;
  readonly digest: Buffer;
  readonly digestType: number;
  readonly keyTag: number;
  readonly kind: "DS";
}

export interface RdataRRSIG {
  readonly algorithm: number;
  readonly algorithmName: string;
  readonly expiration: number;
  readonly inception: number;
  readonly keyTag: number;
  readonly kind: "RRSIG";
  readonly labels: number;
  readonly originalTtl: number;
  readonly signature: Buffer;
  readonly signerName: string;
  readonly typeCovered: number;
}

export interface RdataNSEC {
  readonly kind: "NSEC";
  readonly nextDomainName: string;
  readonly types: readonly number[];
}

export interface RdataNSEC3 {
  readonly flags: number;
  readonly hashAlgorithm: number;
  readonly iterations: number;
  readonly kind: "NSEC3";
  readonly nextHashedOwnerName: Buffer;
  readonly optOut: boolean;
  readonly salt: Buffer;
  readonly types: readonly number[];
}

export interface RdataOPT {
  readonly kind: "OPT";
  readonly options: readonly { code: number; data: Buffer }[];
}

export interface RdataUnknown {
  readonly kind: "UNKNOWN";
  readonly type: number;
}

export type Rdata =
  | RdataA
  | RdataAAAA
  | RdataCNAME
  | RdataNS
  | RdataPTR
  | RdataMX
  | RdataSOA
  | RdataTXT
  | RdataCAA
  | RdataDNSKEY
  | RdataDS
  | RdataRRSIG
  | RdataNSEC
  | RdataNSEC3
  | RdataOPT
  | RdataUnknown;

function algorithmName(algorithm: number): string {
  return DNSSEC_ALGORITHM_NAMES[algorithm] ?? `ALG${algorithm}`;
}

function readIpv4(reader: Reader): string {
  const raw = reader.bytes(4);
  return `${raw[0]}.${raw[1]}.${raw[2]}.${raw[3]}`;
}

function readIpv6(reader: Reader): string {
  const raw = reader.bytes(16);
  const groups: number[] = [];

  for (let i = 0; i < 16; i += 2) {
    groups.push(raw.readUInt16BE(i));
  }

  let bestStart = -1;
  let bestLength = 0;
  let start = -1;
  let length = 0;

  for (let i = 0; i <= groups.length; i += 1) {
    if (i < groups.length && groups[i] === 0) {
      if (start === -1) {
        start = i;
      }
      length += 1;
    } else {
      if (length > bestLength) {
        bestStart = start;
        bestLength = length;
      }
      start = -1;
      length = 0;
    }
  }

  const parts = groups.map((group) => group.toString(16));

  if (bestLength < 2) {
    return parts.join(":");
  }

  const head = parts.slice(0, bestStart).join(":");
  const tail = parts.slice(bestStart + bestLength).join(":");
  return `${head}::${tail}`;
}

function readTypeBitmap(reader: Reader, end: number): number[] {
  const types: number[] = [];

  while (reader.offset < end) {
    const window = reader.uint8();
    const length = reader.uint8();

    if (length < 1 || length > 32) {
      throw new WireFormatError(
        "rdlength-overrun",
        reader.offset,
        `type bitmap block length ${length}`
      );
    }

    const block = reader.bytes(length);

    for (let byteIndex = 0; byteIndex < block.length; byteIndex += 1) {
      const byte = block[byteIndex] ?? 0;

      for (let bit = 0; bit < 8; bit += 1) {
        if (byte & (0x80 >> bit)) {
          types.push(window * 256 + byteIndex * 8 + bit);
        }
      }
    }
  }

  return types;
}

export function decodeRdata(reader: Reader, type: number, end: number): Rdata {
  switch (type) {
    case RecordType.A:
      return { address: readIpv4(reader), kind: "A" };

    case RecordType.AAAA:
      return { address: readIpv6(reader), kind: "AAAA" };

    case RecordType.CNAME:
      return { kind: "CNAME", target: reader.name() };

    case RecordType.NS:
      return { kind: "NS", target: reader.name() };

    case RecordType.PTR:
      return { kind: "PTR", target: reader.name() };

    case RecordType.MX: {
      const preference = reader.uint16();
      const exchange = reader.name();

      return {
        exchange,
        isNullMx: exchange === ".",
        kind: "MX",
        preference,
      };
    }

    case RecordType.SOA: {
      const primary = reader.name();
      const hostmaster = reader.name();
      const serial = reader.uint32();
      const refresh = reader.uint32();
      const retry = reader.uint32();
      const expire = reader.uint32();
      const minimum = reader.uint32();

      return {
        expire,
        hostmaster,
        kind: "SOA",
        minimum,
        primary,
        refresh,
        retry,
        serial,
      };
    }

    case RecordType.TXT: {
      const chunks: Buffer[] = [];

      while (reader.offset < end) {
        chunks.push(reader.characterString());
      }

      return {
        chunks,
        kind: "TXT",
        value: Buffer.concat(chunks).toString("utf8"),
      };
    }

    case RecordType.CAA: {
      const flags = reader.uint8();
      const tagLength = reader.uint8();
      const tag = reader.bytes(tagLength).toString("ascii");
      const value = reader.bytes(end - reader.offset).toString("utf8");

      return {
        critical: (flags & 0x80) !== 0,
        flags,
        kind: "CAA",
        tag,
        value,
      };
    }

    case RecordType.DNSKEY: {
      const flags = reader.uint16();
      const protocol = reader.uint8();
      const algorithm = reader.uint8();

      const publicKey = reader.bytes(end - reader.offset);

      return {
        algorithm,
        algorithmName: algorithmName(algorithm),
        flags,
        isSecureEntryPoint: (flags & 0x00_01) !== 0,
        isZoneKey: (flags & 0x01_00) !== 0,
        kind: "DNSKEY",
        protocol,
        publicKey,
      };
    }

    case RecordType.DS: {
      const keyTag = reader.uint16();
      const algorithm = reader.uint8();

      const digestType = reader.uint8();
      const digest = reader.bytes(end - reader.offset);

      return {
        algorithm,
        algorithmName: algorithmName(algorithm),
        digest,
        digestType,
        keyTag,
        kind: "DS",
      };
    }

    case RecordType.RRSIG: {
      const typeCovered = reader.uint16();
      const algorithm = reader.uint8();

      const labels = reader.uint8();
      const originalTtl = reader.uint32();
      const expiration = reader.uint32();
      const inception = reader.uint32();
      const keyTag = reader.uint16();
      const signerName = reader.name();
      const signature = reader.bytes(end - reader.offset);

      return {
        algorithm,
        algorithmName: algorithmName(algorithm),
        expiration,
        inception,
        keyTag,
        kind: "RRSIG",
        labels,
        originalTtl,
        signature,
        signerName,
        typeCovered,
      };
    }

    case RecordType.NSEC: {
      const nextDomainName = reader.name();
      const types = readTypeBitmap(reader, end);

      return { kind: "NSEC", nextDomainName, types };
    }

    case RecordType.NSEC3: {
      const hashAlgorithm = reader.uint8();
      const flags = reader.uint8();
      const iterations = reader.uint16();
      const saltLength = reader.uint8();
      const salt = reader.bytes(saltLength);
      const hashLength = reader.uint8();
      const nextHashedOwnerName = reader.bytes(hashLength);

      const types = readTypeBitmap(reader, end);

      return {
        flags,
        hashAlgorithm,
        iterations,
        kind: "NSEC3",
        nextHashedOwnerName,
        optOut: (flags & 0x01) !== 0,
        salt,
        types,
      };
    }

    case RecordType.OPT: {
      const options: { code: number; data: Buffer }[] = [];

      while (reader.offset < end) {
        const code = reader.uint16();
        const length = reader.uint16();
        options.push({ code, data: reader.bytes(length) });
      }

      return { kind: "OPT", options };
    }

    default:
      reader.bytes(end - reader.offset);
      return { kind: "UNKNOWN", type };
  }
}
