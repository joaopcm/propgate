import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { deliver } from "./deliver";
import { verifyPayload } from "./sign";

/**
 * Delivery against a real HTTP server.
 *
 * Never a mocked `fetch`, for the same reason DNS is never mocked: a stub agrees
 * with whatever you believed when you wrote it, and everything worth knowing here
 * — that the headers arrive verifiable, that a redirect is not followed, that a
 * timeout is classified as retryable rather than as a refusal — is a property of
 * the transport.
 */

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

/** Starts a server and returns its URL. */
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
    // The end-to-end proof of the signature: the same `verifyPayload` a customer
    // pastes from the docs, run on the bytes that actually arrived over a socket.
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
    // Rate limiting is a request to come back later, not a refusal. Classifying
    // it as permanent would drop events for an endpoint that is merely busy.
    const url = await serving((_request, response) =>
      response.writeHead(429).end()
    );

    expect(await attempt(url)).toMatchObject({ kind: "retryable" });
  });

  it("dead-letters a 404 immediately rather than retrying a wrong URL", async () => {
    // Forty attempts will not make a wrong path correct, and a silent retry loop
    // is how nobody finds out for a week. Failing fast puts it in front of the
    // customer through the deliveries endpoint.
    const url = await serving((_request, response) =>
      response.writeHead(404).end()
    );

    expect(await attempt(url)).toMatchObject({
      kind: "permanent",
      status: 404,
    });
  });

  it("refuses to follow a redirect", async () => {
    // fetch would follow it silently, so a signed POST could arrive at a host the
    // customer never configured — and the signature would still verify there.
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
    // A slow receiver is temporarily slow. This is also the one place wall-clock
    // time enters these specs, so the timeout is small and the server simply
    // never answers.
    const url = await serving(() => {
      // Deliberately no response.
    });

    expect(await attempt(url, 150)).toMatchObject({ kind: "retryable" });
  });

  it("classifies an unreachable host as retryable", async () => {
    // DNS and connection failures land here. A customer's webhook host being
    // briefly unresolvable is exactly what retries are for.
    const outcome = await deliver({
      body: BODY,
      id: "msg_1",
      secrets: [SECRET],
      timeoutMs: 500,
      timestamp: TIMESTAMP,
      // Port 1 on loopback refuses instantly, so this costs no wall-clock time.
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

    // 204 is a success too — a receiver that returns no body has still accepted.
    expect(outcome.kind).toBe("delivered");
    expect(String(header).split(" ")).toHaveLength(2);
  });
});
