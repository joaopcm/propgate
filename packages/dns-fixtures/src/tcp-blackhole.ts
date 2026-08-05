import { createSocket } from "node:dgram";
import { createServer } from "node:net";

/**
 * A server that invites a TCP retry and then swallows it.
 *
 * This is the `TCP_SILENTLY_BLOCKED` fixture. It is not an authoritative server —
 * `nsd` cannot be made to do this, because the behaviour under test is not a
 * property of a zone. It is what a middlebox does to a conversation.
 *
 * **Why a silent TCP listener rather than an iptables DROP.** The obvious
 * reproduction is a `DROP` rule on tcp/53, which needs `NET_ADMIN` and a
 * privileged container, and that requirement is why this code sat unemitted for
 * two milestones. It is also more than the test needs. Our resolver's TCP query
 * arms one deadline covering connect *and* read, so a socket that accepts and
 * never writes produces the identical outcome — `status: "timeout"`,
 * `transport: "tcp"` — as a SYN that vanishes.
 *
 * The two differ at the packet level, and the difference is worth stating rather
 * than glossing: a `DROP` kills the handshake, this one completes it and swallows
 * the query. Both happen in the wild — the first is a firewall rule, the second is
 * a transparent proxy that terminates the connection and cannot speak DNS — and
 * both are indistinguishable to a client with a single deadline. What this fixture
 * cannot cover is a resolver that timed connect separately from read; ours does
 * not, and if it ever does, this needs revisiting rather than trusting.
 *
 * Zero dependencies, like everything else here: `node:dgram` and `node:net`.
 */

/** RFC 1035 §4.1.1. Byte 2 holds QR, OPCODE, AA, TC, RD. */
const FLAGS_HIGH_BYTE = 2;
const QR_RESPONSE = 0b1000_0000;
const TC_TRUNCATED = 0b0000_0010;
const HEADER_BYTES = 12;

export interface Blackhole {
  readonly close: () => Promise<void>;
}

/**
 * Answer every UDP query with the query itself, marked as a truncated response.
 *
 * Echoing the question back is deliberate: it keeps the transaction id, the
 * question section and any EDNS OPT record intact, so the reply parses and
 * matches without this file needing a DNS encoder. `ANCOUNT` stays zero, which is
 * exactly right — a truncated response is allowed to carry nothing and still set
 * TC, and that is precisely the "come back over TCP" signal being tested.
 */
function truncatedResponse(query: Buffer): Buffer {
  const response = Buffer.from(query);

  if (response.length < HEADER_BYTES) {
    return response;
  }

  response[FLAGS_HIGH_BYTE] =
    (response[FLAGS_HIGH_BYTE] ?? 0) | QR_RESPONSE | TC_TRUNCATED;

  return response;
}

export async function startTcpBlackhole(options: {
  readonly address: string;
  readonly port: number;
}): Promise<Blackhole> {
  const udp = createSocket("udp4");
  const tcp = createServer();
  /** Held open deliberately; closing one would send FIN and end the wait. */
  const swallowed: import("node:net").Socket[] = [];

  udp.on("message", (query, from) => {
    udp.send(truncatedResponse(query), from.port, from.address);
  });

  tcp.on("connection", (socket) => {
    // Accept, then nothing. No write, no end, no destroy — the client's deadline
    // is what has to fire, and any response at all would defeat the fixture.
    swallowed.push(socket);
    socket.on("error", () => {
      // A client giving up mid-connection is the expected ending here.
    });
  });

  await Promise.all([
    new Promise<void>((resolve) =>
      udp.bind(options.port, options.address, resolve)
    ),
    new Promise<void>((resolve) =>
      tcp.listen(options.port, options.address, resolve)
    ),
  ]);

  return {
    close: async () => {
      for (const socket of swallowed) {
        socket.destroy();
      }

      await Promise.all([
        new Promise<void>((resolve) => {
          udp.close(resolve);
        }),
        new Promise<void>((resolve) => {
          tcp.close(() => resolve());
        }),
      ]);
    },
  };
}
