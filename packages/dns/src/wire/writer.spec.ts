import { describe, expect, it } from "vitest";
import { Reader } from "./reader";
import { splitName, Writer } from "./writer";

const EXCEEDS_LABEL_LIMIT = /exceeds 63/;
const EXCEEDS_NAME_LIMIT = /over the 255-byte limit/;
const EMPTY_LABEL = /empty label/;
const TRAILING_BACKSLASH = /trailing backslash/;

describe("Writer.name", () => {
  it("encodes labels with length prefixes and a root terminator", () => {
    const encoded = new Writer().name("example.test").toBuffer();

    expect([...encoded]).toEqual([
      7,
      ...Buffer.from("example", "ascii"),
      4,
      ...Buffer.from("test", "ascii"),
      0,
    ]);
  });

  it("treats a trailing dot as equivalent", () => {
    expect(new Writer().name("example.test.").toBuffer()).toEqual(
      new Writer().name("example.test").toBuffer()
    );
  });

  it("encodes the root as a single zero byte", () => {
    expect([...new Writer().name(".").toBuffer()]).toEqual([0]);
    expect([...new Writer().name("").toBuffer()]).toEqual([0]);
  });

  it("round-trips through the reader, escapes included", () => {
    for (const name of [
      "example.test.",
      "_dmarc.example.test.",
      "selector1._domainkey.appended.test.appended.test.",
      "a\\.b.example.test.",
      ".",
    ]) {
      const encoded = new Writer().name(name).toBuffer();

      expect(new Reader(encoded).name(), name).toBe(name);
    }
  });

  it("rejects a label over 63 bytes", () => {
    expect(() => new Writer().name(`${"a".repeat(64)}.test`)).toThrowError(
      EXCEEDS_LABEL_LIMIT
    );
  });

  it("rejects a name over 255 bytes", () => {
    const label = "a".repeat(63);

    expect(() =>
      new Writer().name([label, label, label, label].join("."))
    ).toThrowError(EXCEEDS_NAME_LIMIT);
  });

  it("rejects an empty label, which would encode as a premature root", () => {
    expect(() => new Writer().name("a..b")).toThrowError(EMPTY_LABEL);
  });
});

describe("Writer growth and patching", () => {
  it("grows past its initial allocation", () => {
    const writer = new Writer(4);

    for (let i = 0; i < 100; i += 1) {
      writer.uint32(i);
    }

    expect(writer.length).toBe(400);
    expect(writer.toBuffer().readUInt32BE(396)).toBe(99);
  });

  it("patches a previously written 16-bit field", () => {
    const writer = new Writer();
    writer.uint16(0);
    const at = 0;
    writer.uint16(0xbe_ef);
    writer.patchUint16(at, 0x12_34);

    const out = writer.toBuffer();
    expect(out.readUInt16BE(0)).toBe(0x12_34);
    expect(out.readUInt16BE(2)).toBe(0xbe_ef);
  });
});

describe("splitName", () => {
  it("splits on unescaped dots only", () => {
    expect(splitName("a.b.c").map((b) => b.toString("ascii"))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("keeps an escaped dot inside its label", () => {
    expect(splitName("a\\.b.c").map((b) => b.toString("ascii"))).toEqual([
      "a.b",
      "c",
    ]);
  });

  it("decodes decimal escapes", () => {
    expect([...(splitName("\\000\\255")[0] ?? [])]).toEqual([0, 255]);
  });

  it("decodes an escaped backslash", () => {
    expect(splitName("a\\\\b").map((b) => b.toString("ascii"))).toEqual([
      "a\\b",
    ]);
  });

  it("rejects a trailing backslash", () => {
    expect(() => splitName("abc\\")).toThrowError(TRAILING_BACKSLASH);
  });
});
