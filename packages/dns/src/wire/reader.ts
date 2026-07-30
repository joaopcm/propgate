import {
  COMPRESSION_OFFSET_MASK,
  COMPRESSION_POINTER_MASK,
  MAX_LABEL_LENGTH,
  MAX_NAME_LENGTH,
} from "./constants";
import { WireFormatError } from "./errors";

/**
 * Bounds-checked cursor over a DNS message.
 *
 * Every read validates against the buffer end. That is not defensive
 * programming for its own sake: a truncated or hostile response is a routine
 * observation here, and reading past the end would surface as an
 * ERR_OUT_OF_RANGE from Node rather than as a diagnosable finding.
 */
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

  /** RRSIG and friends carry 48-bit-safe timestamps as unsigned 32-bit seconds. */
  uint48(): number {
    this.require(6);
    const high = this.buffer.readUInt16BE(this.cursor);
    const low = this.buffer.readUInt32BE(this.cursor + 2);
    this.cursor += 6;
    return high * 2 ** 32 + low;
  }

  bytes(length: number): Buffer {
    this.require(length);
    // Copy rather than subarray: callers keep these past the life of the
    // response buffer, and an aliased slice would pin the whole message.
    const value = Buffer.from(
      this.buffer.subarray(this.cursor, this.cursor + length)
    );
    this.cursor += length;
    return value;
  }

  /** RFC 1035 §3.3: a length-prefixed byte string, as used by TXT and CAA. */
  characterString(): Buffer {
    const length = this.uint8();
    return this.bytes(length);
  }

  /**
   * Decode a domain name, following compression pointers.
   *
   * Two limits, and it is worth being precise about why there are only two:
   *
   *  - **Pointers must point strictly backwards.** A forward pointer is the
   *    classic decompression-loop vector and no legitimate encoder emits one.
   *  - **The assembled name is capped at 255 bytes** (RFC 1035 §2.3.4), so a
   *    chain of valid backward pointers cannot inflate into an unbounded name.
   *
   * There is deliberately no visited-offset set. Given backward-only pointers,
   * each jump strictly decreases a non-negative offset, so the chain must
   * terminate — a cycle is unreachable by construction. A guard that can never
   * fire is worse than no guard: it implies a threat the design already rules
   * out, and the next reader has to work out that it is dead code.
   *
   * Returns the name in presentation form with a trailing dot; the root is ".".
   */
  /**
   * Validate and resolve a compression pointer at `offset`.
   *
   * Enforcing "strictly backwards" here is what makes the name loop
   * guaranteed-terminating, so it lives in one place rather than inline.
   */
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

  /**
   * Read one label at `offset`, or null at the root terminator.
   *
   * Split out of `name()` so that method stays a readable state machine:
   * pointer, label, terminator. The length and overrun checks belong with the
   * read they guard.
   */
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

        // Only the first pointer advances the outer at; everything after it
        // is a jump within the message.
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

/**
 * Presentation-form escaping per RFC 1035 §5.1.
 *
 * Labels are arbitrary bytes on the wire, and providers do put odd things in
 * them. Escaping rather than assuming ASCII means a weird label is reported
 * faithfully instead of being silently mangled into something that looks fine.
 */
function escapeLabel(label: Buffer): string {
  let out = "";

  for (const byte of label) {
    if (byte === 0x2e || byte === 0x5c) {
      // "." and "\" would otherwise change the name's structure.
      out += `\\${String.fromCharCode(byte)}`;
    } else if (byte > 0x20 && byte < 0x7f) {
      out += String.fromCharCode(byte);
    } else {
      out += `\\${byte.toString().padStart(3, "0")}`;
    }
  }

  return out;
}
