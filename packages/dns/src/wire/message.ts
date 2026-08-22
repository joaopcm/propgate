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

export interface Flags {
  readonly aa: boolean;
  readonly ad: boolean;
  readonly cd: boolean;
  readonly qr: boolean;
  readonly ra: boolean;
  readonly rd: boolean;
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
  readonly byteLength: number;
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
  readonly rcode: number;
}

export interface EncodeQueryOptions {
  readonly checkingDisabled?: boolean;
  readonly class?: number;
  readonly dnssecOk?: boolean;
  readonly ednsBufferSize?: number;
  readonly id: number;
  readonly name: string;
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
  writer.uint16(1);
  writer.uint16(0);
  writer.uint16(0);
  writer.uint16(wantsOpt ? 1 : 0);

  writer.name(options.name);
  writer.uint16(options.type);
  writer.uint16(options.class ?? RecordClass.IN);

  if (wantsOpt) {
    writer.name(".");
    writer.uint16(RecordType.OPT);
    writer.uint16(options.ednsBufferSize ?? CLASSIC_UDP_LIMIT);
    writer.uint8(0);
    writer.uint8(0);
    writer.uint16(options.dnssecOk ? EDNS_DO : 0);
    writer.uint16(0);
  }

  return writer.toBuffer();
}

function decodeQuestion(reader: Reader): Question {
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
