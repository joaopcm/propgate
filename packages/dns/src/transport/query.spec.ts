import { createSocket, type Socket } from "node:dgram";
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { RecordType } from "../wire/constants";
import { decodeMessage } from "../wire/message";
import { Writer } from "../wire/writer";
import { query } from "./query";

const cleanup: (() => void)[] = [];

afterEach(() => {
  for (const fn of cleanup.splice(0)) {
    fn();
  }
});

async function udpServer(
  handler: (request: Buffer, respond: (response: Buffer) => void) => void
): Promise<number> {
  const socket: Socket = createSocket("udp4");
  cleanup.push(() => socket.close());

  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));

  socket.on("message", (message, remote) => {
    handler(message, (response) =>
      socket.send(response, remote.port, remote.address)
    );
  });

  return socket.address().port;
}

async function tcpServer(
  handler: (request: Buffer, socket: import("node:net").Socket) => void
): Promise<number> {
  const server: Server = createServer((socket) => {
    let buffer = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (buffer.length >= 2 && buffer.length >= 2 + buffer.readUInt16BE(0)) {
        handler(buffer.subarray(2), socket);
      }
    });
    socket.on("error", () => undefined);
  });

  cleanup.push(() => server.close());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP port");
  }

  return address.port;
}

function reply(
  request: Buffer,
  options: { tc?: boolean; id?: number; answer?: Buffer } = {}
): Buffer {
  const writer = new Writer();
  const flags = 0x80_00 | (options.tc ? 0x02_00 : 0);

  writer.uint16(options.id ?? request.readUInt16BE(0));
  writer.uint16(flags);
  writer.uint16(0);
  writer.uint16(options.answer ? 1 : 0);
  writer.uint16(0);
  writer.uint16(0);

  if (options.answer) {
    writer.bytes(options.answer);
  }

  return writer.toBuffer();
}

function aRecord(name: string, address: number[]): Buffer {
  return new Writer()
    .name(name)
    .uint16(RecordType.A)
    .uint16(1)
    .uint32(300)
    .uint16(4)
    .bytes(Buffer.from(address))
    .toBuffer();
}

async function dualServer(handlers: {
  udp: (request: Buffer, respond: (response: Buffer) => void) => void;
  tcp: (request: Buffer, connection: import("node:net").Socket) => void;
}): Promise<number> {
  const server: Server = createServer((connection) => {
    let buffer = Buffer.alloc(0);

    connection.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (buffer.length >= 2 && buffer.length >= 2 + buffer.readUInt16BE(0)) {
        handlers.tcp(buffer.subarray(2), connection);
      }
    });
    connection.on("error", () => undefined);
  });

  cleanup.push(() => server.close());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP port");
  }

  const socket: Socket = createSocket("udp4");
  cleanup.push(() => socket.close());
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(address.port, "127.0.0.1", resolve);
  });

  socket.on("message", (message, remote) => {
    handlers.udp(message, (response) =>
      socket.send(response, remote.port, remote.address)
    );
  });

  return address.port;
}

function frame(response: Buffer): Buffer {
  const framed = Buffer.allocUnsafe(2 + response.length);
  framed.writeUInt16BE(response.length, 0);
  response.copy(framed, 2);
  return framed;
}

describe("query — unreachable", () => {
  it("reports ECONNREFUSED rather than waiting out the timeout", async () => {
    const outcome = await query({
      name: "example.test",
      target: { address: "127.0.0.1", port: 1 },
      timeoutMs: 2000,
      type: RecordType.A,
    });

    expect(outcome.status).toBe("unreachable");
    if (outcome.status === "unreachable") {
      expect(outcome.code).toBe("ECONNREFUSED");
      expect(outcome.elapsedMs).toBeLessThan(1000);
    }
  });
});

describe("query — timeout", () => {
  it("reports a timeout with the deadline it used", async () => {
    const port = await udpServer(() => {
      // never answers
    });

    const outcome = await query({
      name: "example.test",
      target: { address: "127.0.0.1", port },
      timeoutMs: 150,
      type: RecordType.A,
    });

    expect(outcome.status).toBe("timeout");
    if (outcome.status === "timeout") {
      expect(outcome.timeoutMs).toBe(150);
      expect(outcome.transport).toBe("udp");
    }
  });
});

describe("query — response validation", () => {
  it("rejects a reply carrying the wrong message id", async () => {
    const port = await udpServer((request, send) =>
      send(reply(request, { id: (request.readUInt16BE(0) + 1) & 0xff_ff }))
    );

    const outcome = await query({
      name: "example.test",
      target: { address: "127.0.0.1", port },
      timeoutMs: 500,
      type: RecordType.A,
    });

    expect(outcome.status).toBe("malformed");
    if (outcome.status === "malformed") {
      expect(outcome.reason).toBe("id-mismatch");
    }
  });

  it("reports a garbage response as malformed, not as an answer", async () => {
    const port = await udpServer((_request, send) =>
      send(Buffer.from([0x00, 0x01, 0x02]))
    );

    const outcome = await query({
      name: "example.test",
      target: { address: "127.0.0.1", port },
      timeoutMs: 500,
      type: RecordType.A,
    });

    expect(outcome.status).toBe("malformed");
    if (outcome.status === "malformed") {
      expect(outcome.reason).toBe("bad-header");
    }
  });
});

describe("query — truncation and TCP retry", () => {
  it("retries over TCP when the UDP answer is truncated", async () => {
    let tcpQueries = 0;

    const port = await dualServer({
      tcp: (request, socket) => {
        tcpQueries += 1;
        socket.end(
          frame(
            reply(request, { answer: aRecord("example.test", [10, 0, 0, 1]) })
          )
        );
      },
      udp: (request, send) => send(reply(request, { tc: true })),
    });

    const outcome = await query({
      name: "example.test",
      target: { address: "127.0.0.1", port },
      timeoutMs: 1000,
      type: RecordType.A,
    });

    expect(outcome.status).toBe("answered");
    if (outcome.status === "answered") {
      expect(outcome.retriedOverTcp).toBe(true);
      expect(outcome.transport).toBe("tcp");
      expect(outcome.message.answers[0]?.rdata).toEqual({
        address: "10.0.0.1",
        kind: "A",
      });
    }
    expect(tcpQueries).toBe(1);
  });

  it("does not retry when the UDP answer is complete", async () => {
    let tcpQueries = 0;

    const port = await dualServer({
      tcp: (_request, socket) => {
        tcpQueries += 1;
        socket.destroy();
      },
      udp: (request, send) =>
        send(
          reply(request, { answer: aRecord("example.test", [10, 0, 0, 2]) })
        ),
    });

    const outcome = await query({
      name: "example.test",
      target: { address: "127.0.0.1", port },
      timeoutMs: 1000,
      type: RecordType.A,
    });

    expect(outcome.status).toBe("answered");
    if (outcome.status === "answered") {
      expect(outcome.retriedOverTcp).toBe(false);
      expect(outcome.transport).toBe("udp");
    }
    expect(tcpQueries).toBe(0);
  });

  it("returns the truncated answer when the caller declines the retry", async () => {
    const port = await udpServer((request, send) =>
      send(reply(request, { tc: true }))
    );

    const outcome = await query({
      name: "example.test",
      retryOverTcp: false,
      target: { address: "127.0.0.1", port },
      timeoutMs: 500,
      type: RecordType.A,
    });

    expect(outcome.status).toBe("truncated");
    if (outcome.status === "truncated") {
      expect(outcome.message.flags.tc).toBe(true);
    }
  });
});

describe("query — TCP framing", () => {
  it("reassembles a response split across several chunks", async () => {
    const port = await tcpServer((request, socket) => {
      const response = reply(request, {
        answer: aRecord("example.test", [192, 0, 2, 1]),
      });
      const framed = frame(response);

      socket.write(framed.subarray(0, 1));
      setTimeout(() => socket.write(framed.subarray(1, 5)), 5);
      setTimeout(() => socket.write(framed.subarray(5)), 10);
    });

    const outcome = await query({
      name: "example.test",
      target: { address: "127.0.0.1", port, transport: "tcp" },
      timeoutMs: 1000,
      type: RecordType.A,
    });

    expect(outcome.status).toBe("answered");
    if (outcome.status === "answered") {
      expect(outcome.message.answers[0]?.rdata).toEqual({
        address: "192.0.2.1",
        kind: "A",
      });
    }
  });

  it("reports a connection closed mid-response rather than a timeout", async () => {
    const port = await tcpServer((_request, socket) => {
      const framed = Buffer.allocUnsafe(6);
      framed.writeUInt16BE(100, 0);
      framed.writeUInt32BE(0, 2);
      socket.end(framed);
    });

    const outcome = await query({
      name: "example.test",
      target: { address: "127.0.0.1", port, transport: "tcp" },
      timeoutMs: 1000,
      type: RecordType.A,
    });

    expect(outcome.status).toBe("unreachable");
    if (outcome.status === "unreachable") {
      expect(outcome.code).toBe("ECONNCLOSED");
    }
  });
});

describe("query — encoding round trip", () => {
  it("sends no OPT record by default, so the 512-byte cap applies", async () => {
    let seen: Buffer | undefined;
    const port = await udpServer((request, send) => {
      seen = request;
      send(reply(request));
    });

    await query({
      name: "example.test",
      target: { address: "127.0.0.1", port },
      timeoutMs: 500,
      type: RecordType.TXT,
    });

    const decoded = decodeMessage(seen ?? Buffer.alloc(0));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value.edns).toBeUndefined();
      expect(decoded.value.additional).toHaveLength(0);
    }
  });

  it("advertises the requested buffer size and DO bit when asked", async () => {
    let seen: Buffer | undefined;
    const port = await udpServer((request, send) => {
      seen = request;
      send(reply(request));
    });

    await query({
      dnssecOk: true,
      ednsBufferSize: 4096,
      name: "secure.test",
      target: { address: "127.0.0.1", port },
      timeoutMs: 500,
      type: RecordType.SOA,
    });

    const decoded = decodeMessage(seen ?? Buffer.alloc(0));
    if (!decoded.ok) {
      throw new Error("expected the query to decode");
    }
    expect(decoded.value.edns).toEqual({
      dnssecOk: true,
      udpPayloadSize: 4096,
      version: 0,
    });
  });
});
