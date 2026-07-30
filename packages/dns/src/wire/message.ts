import {
  CLASSIC_UDP_LIMIT,
  HEADER_LENGTH,
  RecordClass,
  RecordType,
  type RecordTypeName,
} from "./constants";
import { type DecodeResult, decodeFailure, WireFormatError } from "./errors";
import { decodeRdata, type Rdata } from "./rdata";
import { Reader } from "./reader";
import { Writer } from "./writer";

/**
 * Message encode and decode.
 *
 * The public surface is `encodeQuery` and `decodeMessage`. Decoding never
 * throws: a malformed response is a finding, so it comes back as a
 * `DecodeResult` the caller switches on.
 */

export interface Flags {
  /** Authoritative Answer. Set when the server owns the zone. */
  readonly aa: boolean;
  /** Authentic Data: the resolver validated DNSSEC for this answer. */
  readonly ad: boolean;
  /** Checking Disabled: the client asked to skip validation. */
  readonly cd: boolean;
  /** Response rather than query. */
  readonly qr: boolean;
  readonly ra: boolean;
  readonly rd: boolean;
  /**
   * TrunCation. The single most important flag here, and one c-ares will not
   * surface — without it, an oversized DKIM key looks like a missing record.
   */
  readonly tc: boolean;
}

export interface Question {
  readonly class: number;
  readonly name: string;
  readonly type: number;
}

export interface ResourceRecord {
  readonly class: number;
  readonly name: string;
  readonly rdata: Rdata;
  readonly ttl: number;
  readonly type: number;
}

export interface Message {
  readonly additional: readonly ResourceRecord[];
  readonly answers: readonly ResourceRecord[];
  readonly authority: readonly ResourceRecord[];
  /** Wire size, for the truncation-boundary assertions. */
  readonly byteLength: number;
  /** The OPT pseudo-RR, if the responder sent one. */
  readonly edns:
    | {
        readonly udpPayloadSize: number;
        readonly version: number;
        readonly dnssecOk: boolean;
      }
    | undefined;
  readonly flags: Flags;
  readonly id: number;
  readonly opcode: number;
  readonly questions: readonly Question[];
  /** Includes the extended bits from OPT, so BADVERS surfaces correctly. */
  readonly rcode: number;
}

export interface EncodeQueryOptions {
  /** Ask the resolver not to validate, so bogus data can be inspected. */
  readonly checkingDisabled?: boolean;
  readonly class?: number;
  /** Request DNSSEC records. Implies an OPT record. */
  readonly dnssecOk?: boolean;
  /**
   * Advertised EDNS0 UDP payload size.
   *
   * **Omit to send no OPT record at all.** That is not a micro-optimisation: a
   * query without OPT is capped at 512 bytes by RFC 1035, which is the only way
   * to drive truncation from the client rather than by tuning the server. Any
   * value here, even a small one, changes the semantics.
   */
  readonly ednsBufferSize?: number;
  readonly id: number;
  readonly name: string;
  /** Recursion Desired. False when talking straight to an authoritative server. */
  readonly recursionDesired?: boolean;
  readonly type: number;
}

const FLAG_QR = 0x80_00;
const FLAG_AA = 0x04_00;
const FLAG_TC = 0x02_00;
const FLAG_RD = 0x01_00;
const FLAG_RA = 0x00_80;
const FLAG_AD = 0x00_20;
const FLAG_CD = 0x00_10;
const OPCODE_SHIFT = 11;
const OPCODE_MASK = 0x0f;
const RCODE_MASK = 0x00_0f;
const EDNS_DO = 0x80_00;

export function encodeQuery(options: EncodeQueryOptions): Buffer {
  const writer = new Writer();
  const wantsOpt =
    options.ednsBufferSize !== undefined || options.dnssecOk === true;

  let flags = 0;
  if (options.recursionDesired) {
    flags |= FLAG_RD;
  }
  if (options.checkingDisabled) {
    flags |= FLAG_CD;
  }

  writer.uint16(options.id);
  writer.uint16(flags);
  writer.uint16(1); // qdcount
  writer.uint16(0); // ancount
  writer.uint16(0); // nscount
  writer.uint16(wantsOpt ? 1 : 0); // arcount

  writer.name(options.name);
  writer.uint16(options.type);
  writer.uint16(options.class ?? RecordClass.IN);

  if (wantsOpt) {
    // OPT is a pseudo-RR: root owner name, type OPT, and the "class" field
    // repurposed as the advertised payload size (RFC 6891 §6.1.2).
    writer.name(".");
    writer.uint16(RecordType.OPT);
    writer.uint16(options.ednsBufferSize ?? CLASSIC_UDP_LIMIT);
    writer.uint8(0); // extended rcode
    writer.uint8(0); // version
    writer.uint16(options.dnssecOk ? EDNS_DO : 0);
    writer.uint16(0); // rdlength
  }

  return writer.toBuffer();
}

function decodeQuestion(reader: Reader): Question {
  // Read into locals in wire order, never inline in the object literal.
  // Object properties evaluate in source order, so a formatter that sorts keys
  // alphabetically would silently reorder the reads — which is exactly what
  // happened once here, turning "name, type, class" into "class, name, type"
  // and corrupting every subsequent byte. Locals make the code immune to it.
  const name = reader.name();
  const type = reader.uint16();
  const recordClass = reader.uint16();

  return { class: recordClass, name, type };
}

function decodeRecord(reader: Reader): ResourceRecord {
  const name = reader.name();
  const type = reader.uint16();
  const recordClass = reader.uint16();
  const ttl = reader.uint32();
  const rdlength = reader.uint16();
  const start = reader.offset;
  const end = start + rdlength;

  if (end > reader.buffer.length) {
    throw new WireFormatError(
      "rdlength-overrun",
      start,
      `rdlength ${rdlength} runs past the message`
    );
  }

  const rdata = decodeRdata(reader, type, end);

  // A decoder that consumed the wrong number of bytes would silently corrupt
  // every subsequent record, so this mismatch is worth failing on rather than
  // resynchronising past.
  if (reader.offset !== end) {
    throw new WireFormatError(
      reader.offset > end ? "rdlength-overrun" : "rdlength-underrun",
      reader.offset,
      `${type} consumed ${reader.offset - start} of ${rdlength} bytes`
    );
  }

  return { class: recordClass, name, rdata, ttl, type };
}

function readRecords(reader: Reader, count: number): ResourceRecord[] {
  const records: ResourceRecord[] = [];

  for (let i = 0; i < count; i += 1) {
    records.push(decodeRecord(reader));
  }

  return records;
}

export function decodeMessage(buffer: Buffer): DecodeResult<Message> {
  try {
    if (buffer.length < HEADER_LENGTH) {
      throw new WireFormatError(
        "bad-header",
        0,
        `${buffer.length} bytes is shorter than a header`
      );
    }

    const reader = new Reader(buffer);
    const id = reader.uint16();
    const rawFlags = reader.uint16();
    const qdcount = reader.uint16();
    const ancount = reader.uint16();
    const nscount = reader.uint16();
    const arcount = reader.uint16();

    const questions: Question[] = [];
    for (let i = 0; i < qdcount; i += 1) {
      questions.push(decodeQuestion(reader));
    }

    const answers = readRecords(reader, ancount);
    const authority = readRecords(reader, nscount);
    const additional = readRecords(reader, arcount);

    const opt = additional.find((record) => record.type === RecordType.OPT);
    let rcode = rawFlags & RCODE_MASK;
    let edns: Message["edns"];

    if (opt) {
      // The OPT record smuggles data through fields that mean something else in
      // a normal RR: "class" is the payload size and "ttl" holds the extended
      // rcode, version, and the DO bit.
      const extendedRcode = (opt.ttl >>> 24) & 0xff;
      rcode |= extendedRcode << 4;
      edns = {
        dnssecOk: ((opt.ttl >>> 15) & 0x01) === 1,
        udpPayloadSize: opt.class,
        version: (opt.ttl >>> 16) & 0xff,
      };
    }

    return {
      ok: true,
      value: {
        additional,
        answers,
        authority,
        byteLength: buffer.length,
        edns,
        flags: {
          aa: (rawFlags & FLAG_AA) !== 0,
          ad: (rawFlags & FLAG_AD) !== 0,
          cd: (rawFlags & FLAG_CD) !== 0,
          qr: (rawFlags & FLAG_QR) !== 0,
          ra: (rawFlags & FLAG_RA) !== 0,
          rd: (rawFlags & FLAG_RD) !== 0,
          tc: (rawFlags & FLAG_TC) !== 0,
        },
        id,
        opcode: (rawFlags >> OPCODE_SHIFT) & OPCODE_MASK,
        questions,
        rcode,
      },
    };
  } catch (error) {
    if (error instanceof WireFormatError) {
      return decodeFailure(error);
    }

    throw error;
  }
}

/** Records of one type from a section, narrowed to their rdata shape. */
export function recordsOfType<K extends Rdata["kind"]>(
  records: readonly ResourceRecord[],
  kind: K
): (ResourceRecord & { rdata: Extract<Rdata, { kind: K }> })[] {
  return records.filter(
    (
      record
    ): record is ResourceRecord & {
      rdata: Extract<Rdata, { kind: K }>;
    } => record.rdata.kind === kind
  );
}

export function typeValue(name: RecordTypeName): number {
  return RecordType[name];
}
