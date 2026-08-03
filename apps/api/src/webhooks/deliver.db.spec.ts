import { createServer, type Server } from "node:http";
import type { Database } from "@propgate/db";
import {
  createDb,
  createEndpoint,
  listDeliveries,
  tenants,
  truncateAll,
} from "@propgate/db";
import { verifyPayload } from "@propgate/webhooks";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { attemptDelivery } from "./deliver";
import { enqueueForTransition } from "./enqueue";

/**
 * Transition in, HTTP request out, ledger updated.
 *
 * No Redis: the queue is optional precisely so this path can be tested without
 * one, and the row is the obligation either way. What is under test is that a
 * state change becomes a verifiable request and that the ledger ends up agreeing
 * with what happened.
 */

const db: Database = createDb(process.env.DATABASE_URL ?? "", {
  maxConnections: 4,
});

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

let server: Server | undefined;

beforeEach(async () => {
  await truncateAll(db);
});

afterEach(async () => {
  const running = server;

  server = undefined;

  if (running !== undefined) {
    await new Promise<void>((resolve) => running.close(() => resolve()));
  }
});

afterAll(async () => {
  await db.$client.end();
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

async function fixture(url: string, events: readonly string[] = []) {
  const [tenant] = await db
    .insert(tenants)
    .values({ name: "partner" })
    .returning();
  const tenantId = String(tenant?.id);

  await createEndpoint(db, { events, secret: SECRET, tenantId, url });

  return tenantId;
}

const NOTICE = {
  domain: "example.com",
  domainId: "01927f3a-0000-7000-8000-000000000001",
  externalId: "cust_1",
  from: "verified" as const,
  reason: "3 consecutive failures, reaching the failed threshold",
  to: "failed" as const,
};

describe("a transition reaching a real endpoint", () => {
  it("records the obligation and delivers a request the receiver can verify", async () => {
    let verified: boolean | undefined;
    let body: unknown;

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
        body = JSON.parse(raw);
        response.writeHead(200).end();
      });
    });
    const tenantId = await fixture(url);

    // `domainId` is not a real row here, so the delivery carries a null reference
    // rather than failing the insert — the same shape a deleted domain leaves.
    const recorded = await enqueueForTransition(
      { db },
      { ...NOTICE, domainId: null as unknown as string, tenantId }
    );

    expect(recorded).toBe(1);

    const [delivery] = (await listDeliveries(db, tenantId, { limit: 5 }))
      .deliveries;

    expect(delivery?.status).toBe("pending");

    const result = await attemptDelivery(
      { db, timeoutMs: 2000 },
      { deliveryId: String(delivery?.id), tenantId },
      { allowed: 5, made: 1 }
    );

    expect(result.kind).toBe("delivered");
    expect(verified).toBe(true);
    expect(body).toMatchObject({
      data: { previous_state: "verified", state: "failed" },
      type: "domain.failed",
    });

    const [settled] = (await listDeliveries(db, tenantId, { limit: 5 }))
      .deliveries;

    expect(settled?.status).toBe("delivered");
    expect(settled?.attempts).toBe(1);
  });

  it("asks for a retry on a 500 and leaves the row owed", async () => {
    const url = await serving((_request, response) =>
      response.writeHead(500).end()
    );
    const tenantId = await fixture(url);

    await enqueueForTransition(
      { db },
      { ...NOTICE, domainId: null as unknown as string, tenantId }
    );

    const [delivery] = (await listDeliveries(db, tenantId, { limit: 5 }))
      .deliveries;
    const result = await attemptDelivery(
      { db, timeoutMs: 2000 },
      { deliveryId: String(delivery?.id), tenantId },
      { allowed: 5, made: 1 }
    );

    expect(result.kind).toBe("retry");

    const [pending] = (await listDeliveries(db, tenantId, { limit: 5 }))
      .deliveries;

    // Still owed. The worker throws on `retry`, which is how BullMQ is asked for
    // the backoff, and the reconciler can also find this row.
    expect(pending?.status).toBe("pending");
    expect(pending?.attempts).toBe(1);
  });

  it("dead-letters a 404 on the first attempt", async () => {
    const url = await serving((_request, response) =>
      response.writeHead(404).end()
    );
    const tenantId = await fixture(url);

    await enqueueForTransition(
      { db },
      { ...NOTICE, domainId: null as unknown as string, tenantId }
    );

    const [delivery] = (await listDeliveries(db, tenantId, { limit: 5 }))
      .deliveries;
    const result = await attemptDelivery(
      { db, timeoutMs: 2000 },
      { deliveryId: String(delivery?.id), tenantId },
      { allowed: 5, made: 1 }
    );

    expect(result.kind).toBe("dead-lettered");

    const [failed] = (await listDeliveries(db, tenantId, { limit: 5 }))
      .deliveries;

    expect(failed?.status).toBe("failed");
    // One attempt, not five: a wrong URL is not made right by repetition.
    expect(failed?.attempts).toBe(1);
  });

  it("does not deliver twice when two attempts race for one row", async () => {
    // At-least-once means the reconciler and a live job can both point here. The
    // second one has to notice the row is settled rather than send a duplicate.
    let hits = 0;

    const url = await serving((_request, response) => {
      hits += 1;
      response.writeHead(200).end();
    });
    const tenantId = await fixture(url);

    await enqueueForTransition(
      { db },
      { ...NOTICE, domainId: null as unknown as string, tenantId }
    );

    const [delivery] = (await listDeliveries(db, tenantId, { limit: 5 }))
      .deliveries;
    const payload = { deliveryId: String(delivery?.id), tenantId };

    await attemptDelivery({ db, timeoutMs: 2000 }, payload, {
      allowed: 5,
      made: 1,
    });
    const second = await attemptDelivery({ db, timeoutMs: 2000 }, payload, {
      allowed: 5,
      made: 2,
    });

    expect(second).toMatchObject({ kind: "skipped" });
    expect(hits).toBe(1);
  });

  it("records nothing for a tenant with no endpoint subscribed", async () => {
    // The common case early on, and it must cost one indexed query and no rows.
    const url = await serving((_request, response) =>
      response.writeHead(200).end()
    );
    const tenantId = await fixture(url, ["domain.verified"]);

    const recorded = await enqueueForTransition(
      { db },
      { ...NOTICE, domainId: null as unknown as string, tenantId }
    );

    expect(recorded).toBe(0);
    expect(
      (await listDeliveries(db, tenantId, { limit: 5 })).deliveries
    ).toEqual([]);
  });
});
