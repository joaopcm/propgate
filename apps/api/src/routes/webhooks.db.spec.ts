import type { Database } from "@propgate/db";
import { createApiKey, createDb, tenants, truncateAll } from "@propgate/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";

/**
 * The `/v1/webhooks` family.
 *
 * Deliveries are nested under the endpoint they belong to, so every assertion
 * here is also a check that the family reads as one resource rather than three
 * loosely related ones.
 */

const db: Database = createDb(process.env.DATABASE_URL ?? "", {
  maxConnections: 4,
});

// Nothing here reaches a lookup.
const app = createApp({ db, resolver: { address: "127.0.0.1", port: 53 } });

const URL = "https://partner.example/hooks";

const A_SECRET = /^whsec_/;

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function key(): Promise<string> {
  const [tenant] = await db
    .insert(tenants)
    .values({ name: "partner" })
    .returning();
  const created = await createApiKey(db, {
    name: "k",
    tenantId: String(tenant?.id),
  });

  return created.key;
}

function request(
  apiKey: string,
  path: string,
  init: { body?: unknown; method?: string } = {}
) {
  return app.request(path, {
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    method: init.method ?? "GET",
  });
}

async function makeEndpoint(apiKey: string, url = URL) {
  const response = await request(apiKey, "/v1/webhooks", {
    body: { url },
    method: "POST",
  });

  return (await response.json()).data;
}

describe("POST /v1/webhooks", () => {
  it("returns the secret exactly once, on creation", async () => {
    const apiKey = await key();

    const created = await (
      await request(apiKey, "/v1/webhooks", {
        body: { url: URL },
        method: "POST",
      })
    ).json();

    expect(created.data.secret).toMatch(A_SECRET);
    expect(created.meta.created).toBe(true);

    // A retry is idempotent, and deliberately does not hand the secret back: we
    // keep it to sign with, not to read out. Returning it would turn an idempotent
    // create into a way to recover a secret somebody else configured.
    const retried = await (
      await request(apiKey, "/v1/webhooks", {
        body: { url: URL },
        method: "POST",
      })
    ).json();

    expect(retried.meta.created).toBe(false);
    expect(retried.data.id).toBe(created.data.id);
    expect(retried.data.secret).toBeUndefined();
  });

  it("refuses plain http", async () => {
    // The signature protects the body, not the connection.
    const apiKey = await key();
    const response = await request(apiKey, "/v1/webhooks", {
      body: { url: "http://partner.example/hooks" },
      method: "POST",
    });

    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toContain("https");
  });

  it("refuses a private or loopback address", async () => {
    // Otherwise an endpoint pointing at 169.254.169.254 makes this service a
    // request forwarder into its own network.
    const apiKey = await key();

    const blocked = [
      "https://127.0.0.1/hook",
      "https://localhost/hook",
      "https://10.1.2.3/hook",
      "https://169.254.169.254/latest/meta-data",
    ];

    const statuses = await Promise.all(
      blocked.map(async (url) => ({
        status: (
          await request(apiKey, "/v1/webhooks", {
            body: { url },
            method: "POST",
          })
        ).status,
        url,
      }))
    );

    for (const entry of statuses) {
      expect(entry.status, entry.url).toBe(422);
    }
  });

  it("rejects an event name that is not in the taxonomy", async () => {
    const apiKey = await key();
    const response = await request(apiKey, "/v1/webhooks", {
      body: { events: ["domain.exploded"], url: URL },
      method: "POST",
    });

    expect(response.status).toBe(422);
  });
});

describe("GET and PATCH /v1/webhooks/:id", () => {
  it("reads back what was created", async () => {
    const apiKey = await key();
    const endpoint = await makeEndpoint(apiKey);

    const read = await (
      await request(apiKey, `/v1/webhooks/${endpoint.id}`)
    ).json();

    expect(read.data).toMatchObject({
      disabled: false,
      events: [],
      object: "webhook",
      url: URL,
    });
    // Never on a read. Only the create and the rotation return it.
    expect(read.data.secret).toBeUndefined();
  });

  it("changes the subscription without touching the disabled flag", async () => {
    // The reason `disabled` is absent-means-leave-alone: a PATCH narrowing the
    // events must not silently re-enable something somebody switched off.
    const apiKey = await key();
    const endpoint = await makeEndpoint(apiKey);

    await request(apiKey, `/v1/webhooks/${endpoint.id}`, {
      body: { disabled: true },
      method: "PATCH",
    });
    const patched = await (
      await request(apiKey, `/v1/webhooks/${endpoint.id}`, {
        body: { events: ["domain.failed"] },
        method: "PATCH",
      })
    ).json();

    expect(patched.data.events).toEqual(["domain.failed"]);
    expect(patched.data.disabled).toBe(true);
  });

  it("re-enables an endpoint", async () => {
    const apiKey = await key();
    const endpoint = await makeEndpoint(apiKey);

    await request(apiKey, `/v1/webhooks/${endpoint.id}`, {
      body: { disabled: true },
      method: "PATCH",
    });
    const back = await (
      await request(apiKey, `/v1/webhooks/${endpoint.id}`, {
        body: { disabled: false },
        method: "PATCH",
      })
    ).json();

    expect(back.data.disabled).toBe(false);
  });

  it("404s for another tenant's endpoint", async () => {
    const owner = await key();
    const other = await key();
    const endpoint = await makeEndpoint(owner);

    expect((await request(other, `/v1/webhooks/${endpoint.id}`)).status).toBe(
      404
    );
    expect(
      (
        await request(other, `/v1/webhooks/${endpoint.id}`, {
          body: { disabled: true },
          method: "PATCH",
        })
      ).status
    ).toBe(404);
    expect(
      (
        await request(other, `/v1/webhooks/${endpoint.id}`, {
          method: "DELETE",
        })
      ).status
    ).toBe(404);
  });
});

describe("POST /v1/webhooks/:id/secret", () => {
  it("returns a new secret and says when the old one stops working", async () => {
    // A date rather than a duration, so a customer schedules their redeploy
    // against something concrete.
    const apiKey = await key();
    const endpoint = await makeEndpoint(apiKey);

    const rotated = await (
      await request(apiKey, `/v1/webhooks/${endpoint.id}/secret`, {
        body: {},
        method: "POST",
      })
    ).json();

    expect(rotated.data.secret).toMatch(A_SECRET);
    expect(rotated.data.object).toBe("webhook_secret");
    expect(
      new Date(rotated.meta.previousSecretExpiresAt).getTime()
    ).toBeGreaterThan(Date.now());
  });

  it("accepts a zero window, for rotating because something leaked", async () => {
    const apiKey = await key();
    const endpoint = await makeEndpoint(apiKey);

    const rotated = await (
      await request(apiKey, `/v1/webhooks/${endpoint.id}/secret`, {
        body: { windowHours: 0 },
        method: "POST",
      })
    ).json();

    expect(
      new Date(rotated.meta.previousSecretExpiresAt).getTime()
    ).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("404s rather than creating an endpoint for an unknown id", async () => {
    const apiKey = await key();
    const response = await request(apiKey, "/v1/webhooks/missing/secret", {
      body: {},
      method: "POST",
    });

    expect(response.status).toBe(404);
  });
});

describe("GET /v1/webhooks/:id/deliveries", () => {
  it("is empty for a new endpoint and 404s for an unknown one", async () => {
    // An unknown id must not read as "received nothing" — those are different
    // answers and only one of them means the customer typed the wrong id.
    const apiKey = await key();
    const endpoint = await makeEndpoint(apiKey);

    const empty = await (
      await request(apiKey, `/v1/webhooks/${endpoint.id}/deliveries`)
    ).json();

    expect(empty.data).toEqual([]);
    expect(empty.meta.nextCursor).toBeNull();
    expect(
      (await request(apiKey, "/v1/webhooks/missing/deliveries")).status
    ).toBe(404);
  });

  it("validates the status filter by naming the allowed values", async () => {
    const apiKey = await key();
    const endpoint = await makeEndpoint(apiKey);

    const response = await request(
      apiKey,
      `/v1/webhooks/${endpoint.id}/deliveries?status=exploded`
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toContain("pending");
  });
});

describe("the whole family", () => {
  it("requires authentication everywhere", async () => {
    // One missing `bearerAuth` on one route is a tenant-scoped table read by
    // anybody, so this asserts the mount rather than each handler.
    const paths = [
      "/v1/webhooks",
      "/v1/webhooks/some-id",
      "/v1/webhooks/some-id/deliveries",
    ];

    const statuses = await Promise.all(
      paths.map(async (path) => ({
        path,
        status: (await app.request(path)).status,
      }))
    );

    for (const entry of statuses) {
      expect(entry.status, entry.path).toBe(401);
    }
  });

  it("lists only the calling tenant's endpoints", async () => {
    const owner = await key();
    const other = await key();

    await makeEndpoint(owner);

    const mine = await (await request(owner, "/v1/webhooks")).json();
    const theirs = await (await request(other, "/v1/webhooks")).json();

    expect(mine.data).toHaveLength(1);
    expect(theirs.data).toEqual([]);
  });
});
