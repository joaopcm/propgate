import { createSocket } from "node:dgram";
import { createServer } from "node:net";

const FLAGS_HIGH_BYTE = 2;
const QR_RESPONSE = 0b1000_0000;
const TC_TRUNCATED = 0b0000_0010;
const HEADER_BYTES = 12;

export interface Blackhole {
  readonly close: () => Promise<void>;
}

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
  const swallowed: import("node:net").Socket[] = [];

  udp.on("message", (query, from) => {
    udp.send(truncatedResponse(query), from.port, from.address);
  });

  tcp.on("connection", (socket) => {
    swallowed.push(socket);
    socket.on("error", () => {
      // expected: client hangs up
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
