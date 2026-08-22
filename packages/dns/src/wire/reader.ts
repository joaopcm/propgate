import {
  COMPRESSION_OFFSET_MASK,
  COMPRESSION_POINTER_MASK,
  MAX_LABEL_LENGTH,
  MAX_NAME_LENGTH,
} from "./constants";
import { WireFormatError } from "./errors";

export class Reader {
  readonly buffer: Buffer;
  private cursor: number;

  constructor(buffer: Buffer, offset = 0) {
    this.buffer = buffer;
    this.cursor = offset;
  }

  get offset(): number {
    return this.cursor;
  }

  get remaining(): number {
    return this.buffer.length - this.cursor;
  }

  seek(offset: number): void {
    this.cursor = offset;
  }

  private require(bytes: number): void {
    if (this.cursor + bytes > this.buffer.length) {
      throw new WireFormatError(
        "truncated-buffer",
        this.cursor,
        `needed ${bytes} byte(s), ${this.remaining} left`
      );
    }
  }

  uint8(): number {
    this.require(1);
    const value = this.buffer.readUInt8(this.cursor);
    this.cursor += 1;
    return value;
  }

  uint16(): number {
    this.require(2);
    const value = this.buffer.readUInt16BE(this.cursor);
    this.cursor += 2;
    return value;
  }

  uint32(): number {
    this.require(4);
    const value = this.buffer.readUInt32BE(this.cursor);
    this.cursor += 4;
    return value;
  }

  uint48(): number {
    this.require(6);
    const high = this.buffer.readUInt16BE(this.cursor);
    const low = this.buffer.readUInt32BE(this.cursor + 2);
    this.cursor += 6;
    return high * 2 ** 32 + low;
  }

  bytes(length: number): Buffer {
    this.require(length);
    const value = Buffer.from(
      this.buffer.subarray(this.cursor, this.cursor + length)
    );
    this.cursor += length;
    return value;
  }

  characterString(): Buffer {
    const length = this.uint8();
    return this.bytes(length);
  }

  private pointerTarget(offset: number): number {
    if (offset + 1 >= this.buffer.length) {
      throw new WireFormatError(
        "truncated-buffer",
        offset,
        "compression pointer cut short"
      );
    }

    const target = this.buffer.readUInt16BE(offset) & COMPRESSION_OFFSET_MASK;

    if (target >= offset) {
      throw new WireFormatError(
        "compression-forward-pointer",
        offset,
        `points to ${target}`
      );
    }

    return target;
  }

  private readLabel(
    offset: number
  ): { text: string; byteLength: number } | null {
    const length = this.buffer.readUInt8(offset);

    if (length === 0) {
      return null;
    }

    if (length > MAX_LABEL_LENGTH) {
      throw new WireFormatError("label-too-long", offset, `${length} bytes`);
    }

    if (offset + 1 + length > this.buffer.length) {
      throw new WireFormatError(
        "truncated-buffer",
        offset + 1,
        "label overruns message"
      );
    }

    return {
      byteLength: length,
      text: escapeLabel(this.buffer.subarray(offset + 1, offset + 1 + length)),
    };
  }

  name(): string {
    const labels: string[] = [];
    let totalLength = 0;
    let at = this.cursor;
    let followed = false;

    for (;;) {
      if (at >= this.buffer.length) {
        throw new WireFormatError("unexpected-end", at, "name ran off end");
      }

      const marker = this.buffer.readUInt8(at);

      if ((marker & COMPRESSION_POINTER_MASK) === COMPRESSION_POINTER_MASK) {
        const target = this.pointerTarget(at);

        if (!followed) {
          this.cursor = at + 2;
          followed = true;
        }

        at = target;
        continue;
      }

      const label = this.readLabel(at);

      if (label === null) {
        at += 1;

        if (!followed) {
          this.cursor = at;
        }

        break;
      }

      totalLength += label.byteLength + 1;

      if (totalLength > MAX_NAME_LENGTH) {
        throw new WireFormatError("name-too-long", at, `${totalLength}`);
      }

      labels.push(label.text);
      at += label.byteLength + 1;

      if (!followed) {
        this.cursor = at;
      }
    }

    return labels.length === 0 ? "." : `${labels.join(".")}.`;
  }
}

function escapeLabel(label: Buffer): string {
  let out = "";

  for (const byte of label) {
    if (byte === 0x2e || byte === 0x5c) {
      out += `\\${String.fromCharCode(byte)}`;
    } else if (byte > 0x20 && byte < 0x7f) {
      out += String.fromCharCode(byte);
    } else {
      out += `\\${byte.toString().padStart(3, "0")}`;
    }
  }

  return out;
}
