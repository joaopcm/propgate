import { MAX_LABEL_LENGTH, MAX_NAME_LENGTH } from "./constants";

/** A three-digit decimal escape, per RFC 1035 §5.1 presentation form. */
const DECIMAL_ESCAPE = /^\d{3}$/;

/**
 * Growable buffer for building a DNS message.
 *
 * Deliberately does NOT implement name compression on write. We only ever emit
 * queries, which carry one name; compression would save nothing and cost a
 * correctness risk. Decoding compression is mandatory, encoding it is not.
 */
export class Writer {
  private buffer: Buffer;
  private cursor = 0;

  constructor(initialSize = 512) {
    this.buffer = Buffer.allocUnsafe(initialSize);
  }

  private ensure(bytes: number): void {
    if (this.cursor + bytes <= this.buffer.length) {
      return;
    }

    let size = this.buffer.length * 2;
    while (size < this.cursor + bytes) {
      size *= 2;
    }

    const grown = Buffer.allocUnsafe(size);
    this.buffer.copy(grown, 0, 0, this.cursor);
    this.buffer = grown;
  }

  uint8(value: number): this {
    this.ensure(1);
    this.buffer.writeUInt8(value & 0xff, this.cursor);
    this.cursor += 1;
    return this;
  }

  uint16(value: number): this {
    this.ensure(2);
    this.buffer.writeUInt16BE(value & 0xff_ff, this.cursor);
    this.cursor += 2;
    return this;
  }

  uint32(value: number): this {
    this.ensure(4);
    this.buffer.writeUInt32BE(value >>> 0, this.cursor);
    this.cursor += 4;
    return this;
  }

  bytes(value: Buffer): this {
    this.ensure(value.length);
    value.copy(this.buffer, this.cursor);
    this.cursor += value.length;
    return this;
  }

  /**
   * Encode a domain name.
   *
   * Handles presentation-form escapes (`\.` and `\DDD`) so a name round-trips
   * through the reader. Empty string and "." both mean the root.
   */
  name(value: string): this {
    if (value === "" || value === ".") {
      return this.uint8(0);
    }

    const labels = splitName(value);
    let total = 1;

    for (const label of labels) {
      if (label.length === 0) {
        throw new Error(`empty label in name "${value}"`);
      }

      if (label.length > MAX_LABEL_LENGTH) {
        throw new Error(
          `label of ${label.length} bytes exceeds ${MAX_LABEL_LENGTH} in name "${value}"`
        );
      }

      total += label.length + 1;

      if (total > MAX_NAME_LENGTH) {
        throw new Error(
          `name "${value}" encodes to ${total} bytes, over the ${MAX_NAME_LENGTH}-byte limit`
        );
      }

      this.uint8(label.length).bytes(label);
    }

    return this.uint8(0);
  }

  get length(): number {
    return this.cursor;
  }

  /** Patch a previously written 16-bit field, used for rdlength backfill. */
  patchUint16(offset: number, value: number): void {
    this.buffer.writeUInt16BE(value & 0xff_ff, offset);
  }

  toBuffer(): Buffer {
    return Buffer.from(this.buffer.subarray(0, this.cursor));
  }
}

/**
 * Split a presentation-form name into wire labels, honouring backslash escapes.
 *
 * An escaped dot (`\.`) is part of a label rather than a separator. This matters
 * for the appended-zone-name fixtures, where names are unusual on purpose.
 */
export function splitName(value: string): Buffer[] {
  const trimmed = value.endsWith(".") ? value.slice(0, -1) : value;
  const labels: Buffer[] = [];
  let current: number[] = [];
  let index = 0;

  while (index < trimmed.length) {
    const char = trimmed[index] ?? "";

    if (char === "\\") {
      const next = trimmed.slice(index + 1, index + 4);

      if (DECIMAL_ESCAPE.test(next)) {
        current.push(Number.parseInt(next, 10));
        index += 4;
        continue;
      }

      const escaped = trimmed[index + 1];

      if (escaped === undefined) {
        throw new Error(`trailing backslash in name "${value}"`);
      }

      current.push(escaped.charCodeAt(0));
      index += 2;
      continue;
    }

    if (char === ".") {
      labels.push(Buffer.from(current));
      current = [];
      index += 1;
      continue;
    }

    current.push(...Buffer.from(char, "utf8"));
    index += 1;
  }

  labels.push(Buffer.from(current));
  return labels;
}
