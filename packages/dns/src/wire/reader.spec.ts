import { describe, expect, it } from "vitest";
import { WireFormatError } from "./errors";
import { Reader } from "./reader";

const FORWARD_POINTER = /compression-forward-pointer/;
const LABEL_TOO_LONG = /label-too-long/;
const NAME_TOO_LONG = /name-too-long/;
const TRUNCATED = /truncated-buffer/;

/**
 * Name decoding is where a DNS parser gets attacked, so most of these cases are
 * malformed input rather than happy paths.
 */

function bytes(...values: number[]): Buffer {
  return Buffer.from(values);
}

function labelled(name: string): Buffer {
  const parts = name.split(".").filter(Boolean);
  const out: number[] = [];

  for (const part of parts) {
    out.push(part.length, ...Buffer.from(part, "ascii"));
  }

  out.push(0);
  return Buffer.from(out);
}

describe("Reader integers", () => {
  it("reads big-endian widths and advances the cursor", () => {
    const reader = new Reader(bytes(0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07));

    expect(reader.uint8()).toBe(0x01);
    expect(reader.uint16()).toBe(0x02_03);
    expect(reader.uint32()).toBe(0x04_05_06_07);
    expect(reader.remaining).toBe(0);
  });

  it("reads 48-bit values without losing precision", () => {
    const reader = new Reader(bytes(0xff, 0xff, 0xff, 0xff, 0xff, 0xff));

    expect(reader.uint48()).toBe(281_474_976_710_655);
  });

  it("reports a truncated buffer instead of throwing a range error", () => {
    const reader = new Reader(bytes(0x01));

    expect(() => reader.uint32()).toThrowError(WireFormatError);
    // The offset is what makes the message worth reading.
    try {
      new Reader(bytes(0x01)).uint32();
    } catch (error) {
      expect((error as WireFormatError).reason).toBe("truncated-buffer");
      expect((error as WireFormatError).offset).toBe(0);
    }
  });

  it("copies rather than aliasing, so callers cannot pin the message buffer", () => {
    const source = bytes(0xaa, 0xbb);
    const reader = new Reader(source);
    const taken = reader.bytes(2);

    source[0] = 0x00;

    expect(taken[0]).toBe(0xaa);
  });
});

describe("Reader.name", () => {
  it("decodes a simple name with a trailing dot", () => {
    expect(new Reader(labelled("example.test")).name()).toBe("example.test.");
  });

  it("decodes the root as a bare dot", () => {
    expect(new Reader(bytes(0)).name()).toBe(".");
  });

  it("follows a backward compression pointer", () => {
    // "example.test" at offset 0, then a pointer to it at offset 14.
    const base = labelled("example.test");
    const message = Buffer.concat([base, bytes(0xc0, 0x00)]);
    const reader = new Reader(message, base.length);

    expect(reader.name()).toBe("example.test.");
    // The cursor advances past the 2-byte pointer, not to the pointed-at data.
    expect(reader.offset).toBe(message.length);
  });

  it("follows a pointer that continues into a suffix", () => {
    // "_dmarc" + pointer to "example.test"
    const base = labelled("example.test");
    const message = Buffer.concat([
      base,
      bytes(6, ...Buffer.from("_dmarc", "ascii"), 0xc0, 0x00),
    ]);

    expect(new Reader(message, base.length).name()).toBe(
      "_dmarc.example.test."
    );
  });

  it("rejects a forward pointer, the classic decompression-loop vector", () => {
    const message = bytes(0xc0, 0x04, 0x00, 0x00, 0x00);

    expect(() => new Reader(message).name()).toThrowError(FORWARD_POINTER);
  });

  it("terminates on a chain of backward pointers", () => {
    // The reason there is no visited-offset guard: backward-only pointers make
    // a cycle unreachable, because each jump strictly decreases the offset.
    // This pins that a multi-hop chain resolves rather than spinning.
    //
    // byte 0: root. bytes 1-2: pointer -> 0. bytes 3-4: pointer -> 1.
    const message = bytes(0x00, 0xc0, 0x00, 0xc0, 0x01);

    expect(new Reader(message, 3).name()).toBe(".");
  });

  it("rejects a pointer to itself", () => {
    // target >= cursor covers the self-referential case as well as forward ones.
    const message = bytes(0xc0, 0x00);

    expect(() => new Reader(message).name()).toThrowError(FORWARD_POINTER);
  });

  it("rejects a label longer than 63 bytes", () => {
    const message = Buffer.concat([
      bytes(64),
      Buffer.alloc(64, 0x61),
      bytes(0),
    ]);

    expect(() => new Reader(message).name()).toThrowError(LABEL_TOO_LONG);
  });

  it("rejects a name that assembles to more than 255 bytes", () => {
    // Five 63-byte labels is 320 bytes of name.
    const label = Buffer.concat([bytes(63), Buffer.alloc(63, 0x61)]);
    const message = Buffer.concat([
      label,
      label,
      label,
      label,
      label,
      bytes(0),
    ]);

    expect(() => new Reader(message).name()).toThrowError(NAME_TOO_LONG);
  });

  it("rejects a label that overruns the message", () => {
    const message = bytes(10, 0x61, 0x62);

    expect(() => new Reader(message).name()).toThrowError(TRUNCATED);
  });

  it("escapes dots inside a label so the name structure survives", () => {
    // A single label containing a literal dot — which is exactly what the
    // appended-zone-name pathology can produce.
    const message = Buffer.concat([
      bytes(3),
      Buffer.from("a.b", "ascii"),
      bytes(0),
    ]);

    expect(new Reader(message).name()).toBe("a\\.b.");
  });

  it("escapes non-printable bytes as decimal rather than mangling them", () => {
    const message = Buffer.concat([bytes(2), bytes(0x00, 0xff), bytes(0)]);

    expect(new Reader(message).name()).toBe("\\000\\255.");
  });
});

describe("Reader.characterString", () => {
  it("reads a length-prefixed string", () => {
    const message = Buffer.concat([bytes(3), Buffer.from("abc", "ascii")]);

    expect(new Reader(message).characterString().toString("ascii")).toBe("abc");
  });

  it("reads an empty string", () => {
    expect(new Reader(bytes(0)).characterString()).toHaveLength(0);
  });
});
