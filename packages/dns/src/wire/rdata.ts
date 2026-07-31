import { DNSSEC_ALGORITHM_NAMES, RecordType } from "./constants";
import { WireFormatError } from "./errors";
import type { Reader } from "./reader";

/**
 * RDATA decoders.
 *
 * Each returns a typed shape plus keeps the raw bytes, because several
 * diagnosis codes depend on details a normalised view would discard — the exact
 * TXT chunk boundaries, the RRSIG label count, the DNSKEY flags.
 */

export interface RdataA {
  readonly address: string;
  readonly kind: "A";
}

export interface RdataAAAA {
  readonly address: string;
  readonly kind: "AAAA";
}

/**
 * The three record types whose rdata is a single name.
 *
 * Deliberately three interfaces rather than one with a union `kind`. They are
 * structurally identical, but a union in the discriminant makes
 * `Extract<Rdata, { kind: "NS" }>` resolve to `never`, so `recordsOfType` —
 * this package's only way to pull records of one type out of a section —
 * silently returns nothing for all three. That is a compile-time trap with a
 * runtime-looking symptom.
 */
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

/** Any of the single-name rdata types, when which one does not matter. */
export type RdataName = RdataCNAME | RdataNS | RdataPTR;

export interface RdataMX {
  readonly exchange: string;
  /**
   * RFC 7505: `MX 0 .` means "this domain accepts no mail". Distinct from a
   * preference of 0 pointing at a real host, which providers confuse.
   */
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
  /**
   * The individual character-strings, in order and unjoined.
   *
   * Kept separate on purpose. A TXT rdata is a *sequence* of ≤255-byte strings,
   * and how a provider split a long DKIM key — and whether it inserted
   * whitespace at the boundary — is the finding. Concatenating here would
   * destroy the evidence for TXT_VALUE_SPLIT_MANGLED.
   */
  readonly chunks: readonly Buffer[];
  readonly kind: "TXT";
  /** RFC 6763 §6.1 concatenation: joined with no separator. */
  readonly value: string;
}

export interface RdataCAA {
  /** RFC 8659 §4.1: bit 0 of flags. An unknown critical property must fail. */
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
  /** Bit 0 of flags: this key signs the DNSKEY RRset. */
  readonly isSecureEntryPoint: boolean;
  /** Bit 7 of flags: this is a zone key rather than a bare public key. */
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
  /**
   * The label count of the *original* owner name.
   *
   * This is the authoritative wildcard signal: if `labels` is smaller than the
   * queried name's label count, the answer was synthesised from a wildcard. It
   * is also the single field that makes WILDCARD_FALSE_POSITIVE detectable
   * without a second probe — and c-ares cannot surface it at all.
   */
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
  /** Bit 0 of flags: unsigned delegations may exist in the covered range. */
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

/** RFC 5952 canonical form: lowercase hex, longest run of zero groups elided. */
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

  // A single zero group is written out; only runs of two or more are elided.
  if (bestLength < 2) {
    return parts.join(":");
  }

  const head = parts.slice(0, bestStart).join(":");
  const tail = parts.slice(bestStart + bestLength).join(":");
  return `${head}::${tail}`;
}

/** RFC 4034 §4.1.2 type bitmaps, shared by NSEC and NSEC3. */
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

/**
 * Decode RDATA for a known type, or report it as UNKNOWN.
 *
 * **Never call `reader` inside an object literal here.** Object properties
 * evaluate in source order, so a formatter that sorts keys alphabetically
 * silently reorders the reads and corrupts every byte after the first field.
 * That happened once during development: SOA became
 * expire/hostmaster/minimum/primary/... instead of wire order, and only the
 * fixture tests caught it. Read into locals in wire order, then build the
 * object — the code is then immune to key ordering entirely.
 *
 * `end` is the byte offset where this record's rdata stops. Every branch must
 * consume exactly up to it; the caller enforces that, which is what catches a
 * server whose rdlength disagrees with its own rdata.
 */
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
      // Wire order, held in locals. See the note in decodeRdata's header about
      // why nothing here may read inside an object literal.
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
      // Unknown types are skipped rather than rejected: a zone can legitimately
      // hold record types we do not model, and refusing to parse the message
      // because of one would lose the records we do care about.
      reader.bytes(end - reader.offset);
      return { kind: "UNKNOWN", type };
  }
}
