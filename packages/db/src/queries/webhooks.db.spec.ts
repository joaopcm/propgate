import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client";
import { createDb } from "../client";
import { domains } from "../schema/domains";
import { tenants } from "../schema/tenants";
import { webhookEndpoints } from "../schema/webhooks";
import { truncateAll } from "../test/truncate";
import { createProfileVersion } from "./profiles";
import {
  activeSecrets,
  createEndpoint,
  deleteEndpoint,
  endpointsForEvent,
  listDeliveries,
  listEndpoints,
  markAttemptFailed,
  markDelivered,
  pendingDeliveries,
  recordDelivery,
  rotateSecret,
} from "./webhooks";

/**
 * The ledger, against a real Postgres.
 *
 * Two properties here are the reason this table exists rather than a Redis job
 * being the only record: a delivery survives the queue being flushed, and it
 * survives the domain being deleted. Neither is checkable without a database.
 */

const db: Database = createDb(process.env.DATABASE_URL ?? "", {
  maxConnections: 4,
});

const NOW = new Date("2026-08-03T12:00:00.000Z");
const LATER = new Date("2026-08-03T13:00:00.000Z");

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function tenant(name = "partner"): Promise<string> {
  const [row] = await db.insert(tenants).values({ name }).returning();

  return String(row?.id);
}

async function domain(tenantId: string): Promise<string> {
  const profile = await createProfileVersion(db, {
    definition: { requirements: [] },
    key: "sending",
    tenantId,
  });
  const [row] = await db
    .insert(domains)
    .values({
      name: "example.test",
      profileVersionId: profile.id,
      tenantId,
    })
    .returning({ id: domains.id });

  return String(row?.id);
}

async function endpoint(
  tenantId: string,
  events: readonly string[] = []
): Promise<string> {
  const outcome = await createEndpoint(db, {
    events,
    secret: "whsec_first",
    tenantId,
    url: "https://partner.example/hooks",
  });

  return outcome.endpoint.id;
}

describe("createEndpoint", () => {
  it("is idempotent on the url, so a retry does not double every delivery", async () => {
    const tenantId = await tenant();

    const first = await createEndpoint(db, {
      events: [],
      secret: "whsec_a",
      tenantId,
      url: "https://partner.example/hooks",
    });
    const second = await createEndpoint(db, {
      events: [],
      secret: "whsec_b",
      tenantId,
      url: "https://partner.example/hooks",
    });

    expect(first.kind).toBe("created");
    expect(second.kind).toBe("existing");
    expect(second.endpoint.id).toBe(first.endpoint.id);
    expect(await listEndpoints(db, tenantId)).toHaveLength(1);
  });

  it("does not rotate the secret when a retry finds an existing endpoint", async () => {
    // A retry is not a request to invalidate what the customer already stored.
    const tenantId = await tenant();
    const created = await createEndpoint(db, {
      events: [],
      secret: "whsec_original",
      tenantId,
      url: "https://partner.example/hooks",
    });

    await createEndpoint(db, {
      events: [],
      secret: "whsec_different",
      tenantId,
      url: "https://partner.example/hooks",
    });

    expect(
      await activeSecrets(db, { endpointId: created.endpoint.id, tenantId })
    ).toEqual(["whsec_original"]);
  });

  it("lets two tenants use the same url", async () => {
    const first = await tenant("one");
    const second = await tenant("two");

    await endpoint(first);
    const other = await createEndpoint(db, {
      events: [],
      secret: "whsec_two",
      tenantId: second,
      url: "https://partner.example/hooks",
    });

    expect(other.kind).toBe("created");
  });
});

describe("activeSecrets", () => {
  it("returns one secret outside a rotation window", async () => {
    const tenantId = await tenant();
    const endpointId = await endpoint(tenantId);

    expect(await activeSecrets(db, { endpointId, tenantId })).toEqual([
      "whsec_first",
    ]);
  });

  it("returns both during the window, newest first", async () => {
    // Both are signed with, so a customer who has redeployed and one who has not
    // are each still verifying successfully.
    const tenantId = await tenant();
    const endpointId = await endpoint(tenantId);

    await rotateSecret(db, {
      endpointId,
      expiresAt: LATER,
      secret: "whsec_second",
      tenantId,
    });

    expect(await activeSecrets(db, { endpointId, tenantId }, NOW)).toEqual([
      "whsec_second",
      "whsec_first",
    ]);
  });

  it("drops the old secret the moment the window lapses", async () => {
    // Compared at read time rather than swept by a job: a rotation window that
    // outlives its expiry because a cron did not run is the kind of thing nobody
    // notices until an audit.
    const tenantId = await tenant();
    const endpointId = await endpoint(tenantId);

    await rotateSecret(db, {
      endpointId,
      expiresAt: NOW,
      secret: "whsec_second",
      tenantId,
    });

    expect(await activeSecrets(db, { endpointId, tenantId }, LATER)).toEqual([
      "whsec_second",
    ]);
  });

  it("is empty for an endpoint belonging to another tenant", async () => {
    // Every query here is tenant-scoped. Signing with a secret fetched across a
    // tenant boundary would be the worst bug in this file.
    const owner = await tenant("one");
    const other = await tenant("two");
    const endpointId = await endpoint(owner);

    expect(await activeSecrets(db, { endpointId, tenantId: other })).toEqual(
      []
    );
  });
});

describe("endpointsForEvent", () => {
  it("treats an empty subscription list as everything", async () => {
    const tenantId = await tenant();

    await endpoint(tenantId, []);

    expect(
      await endpointsForEvent(db, { event: "domain.failed", tenantId })
    ).toHaveLength(1);
  });

  it("respects a specific subscription", async () => {
    const tenantId = await tenant();

    await endpoint(tenantId, ["domain.failed"]);

    expect(
      await endpointsForEvent(db, { event: "domain.failed", tenantId })
    ).toHaveLength(1);
    expect(
      await endpointsForEvent(db, { event: "domain.degraded", tenantId })
    ).toHaveLength(0);
  });

  it("excludes a disabled endpoint, so turning one off stops the obligation", async () => {
    // Filtered here rather than at delivery time on purpose: a disabled endpoint
    // should accrue no rows at all, not a backlog waiting to be re-enabled.
    const tenantId = await tenant();
    const endpointId = await endpoint(tenantId);

    await db
      .update(webhookEndpoints)
      .set({ disabledAt: NOW })
      .where(eq(webhookEndpoints.id, endpointId));

    expect(
      await endpointsForEvent(db, { event: "domain.failed", tenantId })
    ).toHaveLength(0);
  });
});

describe("the delivery ledger", () => {
  it("records what is owed before anything is sent", async () => {
    const tenantId = await tenant();
    const endpointId = await endpoint(tenantId);
    const domainId = await domain(tenantId);

    const delivery = await recordDelivery(db, {
      domainId,
      endpointId,
      event: "domain.failed",
      payload: { type: "domain.failed" },
      tenantId,
    });

    expect(delivery.status).toBe("pending");
    expect(delivery.attempts).toBe(0);
    expect(delivery.deliveredAt).toBeNull();
  });

  it("freezes the payload rather than describing the domain later", async () => {
    // A retry three minutes on must describe the state that fired the event, not
    // the state the domain has drifted to since — and the signature covers these
    // exact bytes, so they cannot change between attempts.
    const tenantId = await tenant();
    const endpointId = await endpoint(tenantId);
    const domainId = await domain(tenantId);
    const payload = { data: { state: "failed" }, type: "domain.failed" };

    const delivery = await recordDelivery(db, {
      domainId,
      endpointId,
      event: "domain.failed",
      payload,
      tenantId,
    });

    await db
      .update(domains)
      .set({ state: "verified" })
      .where(eq(domains.id, domainId));

    const [reread] = (await listDeliveries(db, tenantId, { limit: 10 }))
      .deliveries;

    expect(reread?.payload).toEqual(payload);
    expect(delivery.payload).toEqual(payload);
  });

  it("survives the domain being deleted", async () => {
    // "Why did I never get the failure notification for the domain I then
    // deleted" is exactly the question this table answers, so the reference is
    // set null rather than cascaded.
    const tenantId = await tenant();
    const endpointId = await endpoint(tenantId);
    const domainId = await domain(tenantId);

    await recordDelivery(db, {
      domainId,
      endpointId,
      event: "domain.failed",
      payload: {},
      tenantId,
    });

    await db.delete(domains);

    const page = await listDeliveries(db, tenantId, { limit: 10 });

    expect(page.deliveries).toHaveLength(1);
    expect(page.deliveries[0]?.domainId).toBeNull();
  });

  it("counts attempts and keeps the last error while retries remain", async () => {
    const tenantId = await tenant();
    const endpointId = await endpoint(tenantId);
    const delivery = await recordDelivery(db, {
      domainId: null,
      endpointId,
      event: "domain.failed",
      payload: {},
      tenantId,
    });

    await markAttemptFailed(db, {
      deliveryId: delivery.id,
      error: "503 Service Unavailable",
      exhausted: false,
    });

    const [row] = (await listDeliveries(db, tenantId, { limit: 10 }))
      .deliveries;

    // Still pending: the reconciler may pick it up, and the customer has not been
    // told anything final.
    expect(row?.status).toBe("pending");
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toContain("503");
  });

  it("dead-letters once the retries are exhausted", async () => {
    const tenantId = await tenant();
    const endpointId = await endpoint(tenantId);
    const delivery = await recordDelivery(db, {
      domainId: null,
      endpointId,
      event: "domain.failed",
      payload: {},
      tenantId,
    });

    await markAttemptFailed(db, {
      deliveryId: delivery.id,
      error: "connect ECONNREFUSED",
      exhausted: true,
    });

    const page = await listDeliveries(db, tenantId, {
      limit: 10,
      status: "failed",
    });

    expect(page.deliveries).toHaveLength(1);
    expect(page.deliveries[0]?.lastError).toContain("ECONNREFUSED");
  });

  it("clears the error when a retry finally succeeds", async () => {
    const tenantId = await tenant();
    const endpointId = await endpoint(tenantId);
    const delivery = await recordDelivery(db, {
      domainId: null,
      endpointId,
      event: "domain.failed",
      payload: {},
      tenantId,
    });

    await markAttemptFailed(db, {
      deliveryId: delivery.id,
      error: "503",
      exhausted: false,
    });
    await markDelivered(db, delivery.id, LATER);

    const [row] = (await listDeliveries(db, tenantId, { limit: 10 }))
      .deliveries;

    expect(row?.status).toBe("delivered");
    expect(row?.attempts).toBe(2);
    // A stale error on a delivered row would send someone hunting a problem that
    // resolved itself.
    expect(row?.lastError).toBeNull();
  });
});

describe("listDeliveries", () => {
  it("is newest first and pages by keyset", async () => {
    const tenantId = await tenant();
    const endpointId = await endpoint(tenantId);

    // Sequential rather than a loop or Promise.all: the ids are uuidv7 and the
    // assertion below is about their order, which concurrent inserts would not
    // guarantee.
    const record = (event: string) =>
      recordDelivery(db, {
        domainId: null,
        endpointId,
        event,
        payload: {},
        tenantId,
      });

    await record("domain.verified");
    await record("domain.degraded");
    await record("domain.failed");

    const first = await listDeliveries(db, tenantId, { limit: 2 });

    expect(first.deliveries.map((row) => row.event)).toEqual([
      "domain.failed",
      "domain.degraded",
    ]);
    expect(first.nextCursor).not.toBeNull();

    const second = await listDeliveries(db, tenantId, {
      cursor: String(first.nextCursor),
      limit: 2,
    });

    expect(second.deliveries.map((row) => row.event)).toEqual([
      "domain.verified",
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it("does not leak another tenant's deliveries", async () => {
    const owner = await tenant("one");
    const other = await tenant("two");
    const endpointId = await endpoint(owner);

    await recordDelivery(db, {
      domainId: null,
      endpointId,
      event: "domain.failed",
      payload: {},
      tenantId: owner,
    });

    expect((await listDeliveries(db, other, { limit: 10 })).deliveries).toEqual(
      []
    );
  });
});

describe("pendingDeliveries", () => {
  it("returns what is still owed, oldest first", async () => {
    // Oldest first so a backlog drains in the order it accrued rather than
    // starving the earliest events.
    const tenantId = await tenant();
    const endpointId = await endpoint(tenantId);
    const first = await recordDelivery(db, {
      domainId: null,
      endpointId,
      event: "domain.verified",
      payload: {},
      tenantId,
    });

    await recordDelivery(db, {
      domainId: null,
      endpointId,
      event: "domain.failed",
      payload: {},
      tenantId,
    });
    await markDelivered(db, first.id);

    const owed = await pendingDeliveries(db, { limit: 10 });

    expect(owed).toHaveLength(1);
    expect(owed[0]?.tenantId).toBe(tenantId);
  });
});

describe("deleteEndpoint", () => {
  it("takes its deliveries with it, and only for its own tenant", async () => {
    const owner = await tenant("one");
    const other = await tenant("two");
    const endpointId = await endpoint(owner);

    await recordDelivery(db, {
      domainId: null,
      endpointId,
      event: "domain.failed",
      payload: {},
      tenantId: owner,
    });

    expect(await deleteEndpoint(db, { endpointId, tenantId: other })).toBe(
      false
    );
    expect(await deleteEndpoint(db, { endpointId, tenantId: owner })).toBe(
      true
    );
    expect((await listDeliveries(db, owner, { limit: 10 })).deliveries).toEqual(
      []
    );
  });
});
