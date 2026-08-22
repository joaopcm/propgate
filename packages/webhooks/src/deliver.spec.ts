import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { deliver } from "./deliver";
import { verifyPayload } from "./sign";

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const BODY = '{"type":"domain.verified"}';
const TIMESTAMP = 1_785_782_400;

let server: Server | undefined;

afterEach(async () => {
  const running = server;

  server = undefined;

  if (running !== undefined) {
    await new Promise<void>((resolve) => running.close(() => resolve()));
  }
});

async function serving(
  handler: (
    request: import("node:http").IncomingMessage,
    response: import("node:http").ServerResponse
  ) => void
): Promise<string> {
  const started = createServer(handler);

  server = started;

  await new Promise<void>((resolve) => {
    started.listen(0, "127.0.0.1", () => resolve());
  });

  const address = started.address();

  if (address === null || typeof address === "string") {
    throw new Error("the fixture server did not bind a port");
  }

  return `http://127.0.0.1:${address.port}/hook`;
}

function attempt(url: string, timeoutMs = 2000) {
  return deliver({
    body: BODY,
    id: "msg_1",
    secrets: [SECRET],
    timeoutMs,
    timestamp: TIMESTAMP,
    url,
  });
}

describe("deliver", () => {
  it("sends a body a receiver can verify with the documented code", async () => {
    let verified: boolean | undefined;
    let receivedType: string | undefined;

    const url = await serving((request, response) => {
      let raw = "";

      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        verified = verifyPayload({
          body: raw,
          header: String(request.headers["webhook-signature"]),
          id: String(request.headers["webhook-id"]),
          secret: SECRET,
          timestamp: Number(request.headers["webhook-timestamp"]),
        });
        receivedType = String(JSON.parse(raw).type);
        response.writeHead(200).end();
      });
    });

    const outcome = await attempt(url);

    expect(outcome.kind).toBe("delivered");
    expect(verified).toBe(true);
    expect(receivedType).toBe("domain.verified");
  });

  it("treats a 500 as worth retrying", async () => {
    const url = await serving((_request, response) =>
      response.writeHead(500).end()
    );

    expect(await attempt(url)).toMatchObject({ kind: "retryable" });
  });

  it("treats a 429 as worth retrying despite being a 4xx", async () => {
    const url = await serving((_request, response) =>
      response.writeHead(429).end()
    );

    expect(await attempt(url)).toMatchObject({ kind: "retryable" });
  });

  it("dead-letters a 404 immediately rather than retrying a wrong URL", async () => {
    const url = await serving((_request, response) =>
      response.writeHead(404).end()
    );

    expect(await attempt(url)).toMatchObject({
      kind: "permanent",
      status: 404,
    });
  });

  it("refuses to follow a redirect", async () => {
    let hits = 0;

    const url = await serving((request, response) => {
      hits += 1;

      if (request.url === "/hook") {
        response.writeHead(307, { location: "/elsewhere" }).end();

        return;
      }

      response.writeHead(200).end();
    });

    const outcome = await attempt(url);

    expect(outcome.kind).toBe("permanent");
    expect(hits).toBe(1);
  });

  it("classifies a timeout as retryable, not as a refusal", async () => {
    const url = await serving(() => {
      // no response
    });

    expect(await attempt(url, 150)).toMatchObject({ kind: "retryable" });
  });

  it("classifies an unreachable host as retryable", async () => {
    const outcome = await deliver({
      body: BODY,
      id: "msg_1",
      secrets: [SECRET],
      timeoutMs: 500,
      timestamp: TIMESTAMP,
      url: "http://127.0.0.1:1/hook",
    });

    expect(outcome.kind).toBe("retryable");
  });

  it("sends both signatures during a rotation window", async () => {
    let header: string | undefined;

    const url = await serving((request, response) => {
      header = String(request.headers["webhook-signature"]);
      response.writeHead(204).end();
    });

    const outcome = await deliver({
      body: BODY,
      id: "msg_1",
      secrets: [SECRET, "whsec_b2xkc2VjcmV0dmFsdWVoZXJlMTIzNA=="],
      timeoutMs: 2000,
      timestamp: TIMESTAMP,
      url,
    });

    expect(outcome.kind).toBe("delivered");
    expect(String(header).split(" ")).toHaveLength(2);
  });
});
