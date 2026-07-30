import { describe, expect, it } from "vitest";
import { RecordType } from "./constants";
import { decodeMessage, encodeQuery } from "./message";
import { Writer } from "./writer";

/**
 * Round-trip and malformed-input coverage for the message layer. The
 * fixture-backed specs exercise real servers; these pin behaviour that would be
 * awkward or impossible to provoke from a well-behaved one.
 */

function record(
  name: string,
  type: number,
  ttl: number,
  rdata: Buffer,
  options: { rdlength?: number } = {}
): Buffer {
  const writer = new Writer();
  writer.name(name);
  writer.uint16(type);
  writer.uint16(1);
  writer.uint32(ttl);
  writer.uint16(options.rdlength ?? rdata.length);
  writer.bytes(rdata);
  return writer.toBuffer();
}

function response(options: {
  flags?: number;
  answers?: Buffer[];
  authority?: Buffer[];
  additional?: Buffer[];
  question?: { name: string; type: number };
}): Buffer {
  const writer = new Writer();
  const answers = options.answers ?? [];
  const authority = options.authority ?? [];
  const additional = options.additional ?? [];

  writer.uint16(0x12_34);
  writer.uint16(options.flags ?? 0x80_00);
  writer.uint16(options.question ? 1 : 0);
  writer.uint16(answers.length);
  writer.uint16(authority.length);
  writer.uint16(additional.length);

  if (options.question) {
    writer.name(options.question.name);
    writer.uint16(options.question.type);
    writer.uint16(1);
  }

  for (const section of [answers, authority, additional]) {
    for (const rr of section) {
      writer.bytes(rr);
    }
  }

  return writer.toBuffer();
}

function unwrap(buffer: Buffer) {
  const result = decodeMessage(buffer);

  if (!result.ok) {
    throw new Error(`expected a decodable message, got ${result.message}`);
  }

  return result.value;
}

describe("encodeQuery", () => {
  it("omits the OPT record entirely when no EDNS options are given", () => {
    const query = encodeQuery({
      id: 1,
      name: "example.test",
      type: RecordType.TXT,
    });

    // arcount must be 0. This is what makes the 512-byte cap apply, and it is
    // the whole mechanism behind the truncation fixtures.
    expect(query.readUInt16BE(10)).toBe(0);
    expect(unwrap(query).edns).toBeUndefined();
  });

  it("adds an OPT record when a buffer size is advertised", () => {
    const query = encodeQuery({
      ednsBufferSize: 1232,
      id: 1,
      name: "example.test",
      type: RecordType.TXT,
    });

    expect(query.readUInt16BE(10)).toBe(1);
    expect(unwrap(query).edns).toEqual({
      dnssecOk: false,
      udpPayloadSize: 1232,
      version: 0,
    });
  });

  it("sets DO and implies an OPT record when DNSSEC is requested", () => {
    const query = encodeQuery({
      dnssecOk: true,
      id: 1,
      name: "secure.test",
      type: RecordType.SOA,
    });

    expect(unwrap(query).edns?.dnssecOk).toBe(true);
  });

  it("sets RD only when asked, since authoritative queries must not recurse", () => {
    const plain = encodeQuery({ id: 1, name: "a.test", type: 1 });
    const recursive = encodeQuery({
      id: 1,
      name: "a.test",
      recursionDesired: true,
      type: 1,
    });

    expect(unwrap(plain).flags.rd).toBe(false);
    expect(unwrap(recursive).flags.rd).toBe(true);
  });

  it("round-trips the question", () => {
    const query = encodeQuery({
      id: 0xab_cd,
      name: "selector1._domainkey.appended.test.appended.test",
      type: RecordType.TXT,
    });
    const message = unwrap(query);

    expect(message.id).toBe(0xab_cd);
    expect(message.questions[0]).toEqual({
      class: 1,
      name: "selector1._domainkey.appended.test.appended.test.",
      type: RecordType.TXT,
    });
  });
});

describe("decodeMessage flags", () => {
  it("decodes the TC bit, which c-ares cannot expose at all", () => {
    // qr + aa + tc
    const message = unwrap(response({ flags: 0x80_00 | 0x04_00 | 0x02_00 }));

    expect(message.flags.tc).toBe(true);
    expect(message.flags.aa).toBe(true);
  });

  it("decodes the AD bit for validated answers", () => {
    expect(unwrap(response({ flags: 0x80_00 | 0x00_20 })).flags.ad).toBe(true);
  });

  it("distinguishes REFUSED from SERVFAIL", () => {
    expect(unwrap(response({ flags: 0x80_00 | 5 })).rcode).toBe(5);
    expect(unwrap(response({ flags: 0x80_00 | 2 })).rcode).toBe(2);
  });

  it("reconstructs an extended RCODE from the OPT record", () => {
    // BADVERS is 16: low 4 bits in the header, upper bits in OPT's ttl field.
    const writer = new Writer();
    writer.name(".");
    writer.uint16(RecordType.OPT);
    writer.uint16(1232);
    writer.uint32(0x01_00_00_00); // extended rcode 1 -> 1<<4 = 16
    writer.uint16(0);

    const message = unwrap(
      response({ additional: [writer.toBuffer()], flags: 0x80_00 })
    );

    expect(message.rcode).toBe(16);
  });
});

describe("decodeMessage sections", () => {
  it("keeps TXT chunks separate so split mangling stays visible", () => {
    const rdata = Buffer.concat([
      Buffer.from([5]),
      Buffer.from("first", "ascii"),
      Buffer.from([6]),
      Buffer.from("second", "ascii"),
    ]);
    const message = unwrap(
      response({ answers: [record("a.test", RecordType.TXT, 300, rdata)] })
    );
    const txt = message.answers[0]?.rdata;

    if (txt?.kind !== "TXT") {
      throw new Error("expected TXT");
    }

    expect(txt.chunks.map((c) => c.toString("ascii"))).toEqual([
      "first",
      "second",
    ]);
    // Concatenation is separator-free per RFC 6763 §6.1.
    expect(txt.value).toBe("firstsecond");
  });

  it("recognises a null MX and does not confuse it with preference 0", () => {
    const nullMx = Buffer.concat([Buffer.from([0, 0]), Buffer.from([0])]);
    const realMx = new Writer().uint16(0).name("mx.a.test").toBuffer();

    const nullResult = unwrap(
      response({ answers: [record("a.test", RecordType.MX, 300, nullMx)] })
    ).answers[0]?.rdata;
    const realResult = unwrap(
      response({ answers: [record("a.test", RecordType.MX, 300, realMx)] })
    ).answers[0]?.rdata;

    if (nullResult?.kind !== "MX" || realResult?.kind !== "MX") {
      throw new Error("expected MX");
    }

    expect(nullResult.isNullMx).toBe(true);
    expect(realResult.isNullMx).toBe(false);
    expect(realResult.preference).toBe(0);
  });

  it("exposes the authority-section SOA of an NXDOMAIN", () => {
    // The negative-cache TTL is min(SOA MINIMUM, the SOA record's own TTL), and
    // reading it requires the authority section — which c-ares discards.
    const soa = new Writer()
      .name("ns1.test")
      .name("hostmaster.test")
      .uint32(1)
      .uint32(7200)
      .uint32(3600)
      .uint32(1_209_600)
      .uint32(3600)
      .toBuffer();

    const message = unwrap(
      response({
        authority: [record("negcache.test", RecordType.SOA, 300, soa)],
        flags: 0x80_00 | 3,
      })
    );

    expect(message.rcode).toBe(3);
    const [record0] = message.authority;
    if (record0?.rdata.kind !== "SOA") {
      throw new Error("expected SOA");
    }
    expect(record0.ttl).toBe(300);
    expect(record0.rdata.minimum).toBe(3600);
    expect(Math.min(record0.rdata.minimum, record0.ttl)).toBe(300);
  });

  it("exposes RRSIG labels, the authoritative wildcard signal", () => {
    const rrsig = new Writer()
      .uint16(RecordType.TXT)
      .uint8(8)
      .uint8(2) // labels: the original owner had 2, so a 3-label answer is synthesised
      .uint32(300)
      .uint32(2_000_000_000)
      .uint32(1_000_000_000)
      .uint16(1234)
      .name("wildcard-signed.test")
      .bytes(Buffer.alloc(16, 0xab))
      .toBuffer();

    const message = unwrap(
      response({
        answers: [
          record("anything.wildcard-signed.test", RecordType.RRSIG, 300, rrsig),
        ],
      })
    );
    const sig = message.answers[0]?.rdata;

    if (sig?.kind !== "RRSIG") {
      throw new Error("expected RRSIG");
    }

    expect(sig.labels).toBe(2);
    expect(sig.algorithmName).toBe("RSASHA256");
    expect(sig.typeCovered).toBe(RecordType.TXT);
  });

  it("decodes CAA including the critical bit and a quoted deny-all", () => {
    const rdata = Buffer.concat([
      Buffer.from([0x80, 5]),
      Buffer.from("issue", "ascii"),
      Buffer.from(";", "ascii"),
    ]);
    const message = unwrap(
      response({ answers: [record("a.test", RecordType.CAA, 300, rdata)] })
    );
    const caa = message.answers[0]?.rdata;

    if (caa?.kind !== "CAA") {
      throw new Error("expected CAA");
    }

    expect(caa.critical).toBe(true);
    expect(caa.tag).toBe("issue");
    expect(caa.value).toBe(";");
  });

  it("decodes an NSEC type bitmap", () => {
    const rdata = Buffer.concat([
      new Writer().name("next.a.test").toBuffer(),
      // window 0, 1 byte, bits for A (1) and NS (2)
      Buffer.from([0, 1, 0b0110_0000]),
    ]);
    const message = unwrap(
      response({ answers: [record("a.test", RecordType.NSEC, 300, rdata)] })
    );
    const nsec = message.answers[0]?.rdata;

    if (nsec?.kind !== "NSEC") {
      throw new Error("expected NSEC");
    }

    expect(nsec.types).toEqual([1, 2]);
    expect(nsec.nextDomainName).toBe("next.a.test.");
  });

  it("skips an unknown record type without losing the rest of the message", () => {
    const message = unwrap(
      response({
        answers: [
          record("a.test", 9999, 300, Buffer.alloc(7, 0x11)),
          record("a.test", RecordType.A, 300, Buffer.from([1, 2, 3, 4])),
        ],
      })
    );

    expect(message.answers[0]?.rdata).toEqual({ kind: "UNKNOWN", type: 9999 });
    expect(message.answers[1]?.rdata).toEqual({
      address: "1.2.3.4",
      kind: "A",
    });
  });

  it("decodes IPv6 in canonical RFC 5952 form", () => {
    const address = Buffer.from([
      0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ]);
    const message = unwrap(
      response({ answers: [record("a.test", RecordType.AAAA, 300, address)] })
    );

    expect(message.answers[0]?.rdata).toEqual({
      address: "2001:db8::1",
      kind: "AAAA",
    });
  });
});

describe("decodeMessage failures are values, not throws", () => {
  it("reports a short header", () => {
    const result = decodeMessage(Buffer.alloc(4));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("bad-header");
    }
  });

  it("reports an rdlength that overruns the message", () => {
    const result = decodeMessage(
      response({
        answers: [
          record("a.test", RecordType.A, 300, Buffer.from([1, 2, 3, 4]), {
            rdlength: 400,
          }),
        ],
      })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("rdlength-overrun");
    }
  });

  it("reports an rdlength that disagrees with the rdata it frames", () => {
    // rdlength says 8 but an A record consumes 4, which would silently
    // desynchronise every following record.
    const result = decodeMessage(
      response({
        answers: [
          record(
            "a.test",
            RecordType.A,
            300,
            Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
            { rdlength: 8 }
          ),
        ],
      })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("rdlength-underrun");
    }
  });

  it("reports a section count larger than the records present", () => {
    const writer = new Writer();
    writer.uint16(1);
    writer.uint16(0x80_00);
    writer.uint16(0);
    writer.uint16(5); // claims five answers, sends none
    writer.uint16(0);
    writer.uint16(0);

    const result = decodeMessage(writer.toBuffer());

    expect(result.ok).toBe(false);
  });
});
