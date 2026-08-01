import type { Database } from "@propgate/db";
import { createApiKey, createDb, tenants, truncateAll } from "@propgate/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";

/**
 * The routes, without DNS.
 *
 * Registration, tenancy, and the shape of every answer. The half that needs a
 * resolver — what a check does to a domain's state and its timeline — is in
 * `domains.fixture.spec.ts`, against the real tier.
 */

const db: Database = createDb(process.env.DATABASE_URL ?? "", {
  maxConnections: 4,
});

// Nothing here reaches a lookup; the address is never asked anything.
const app = createApp({ db, resolver: { address: "127.0.0.1", port: 53 } });

const SENDING = {
  key: "sending",
  requirements: [
    { check: "spf", include: "one.spf.test", key: "spf" },
    { check: "dkim", key: "dkim", selector: "pg1" },
  ],
};

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function tenantKey(name: string): Promise<string> {
  const [tenant] = await db.insert(tenants).values({ name }).returning();
  const created = await createApiKey(db, {
    name: "k",
    tenantId: String(tenant?.id),
  });

  return created.key;
}

function request(
  key: string,
  path: string,
  init: { body?: unknown; method?: string } = {}
) {
  return app.request(path, {
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    method: init.method ?? "GET",
  });
}

async function withProfile(key: string) {
  const response = await request(key, "/v1/profiles", {
    body: SENDING,
    method: "POST",
  });

  return (await response.json()).data;
}

async function register(
  key: string,
  body: { externalId?: string; name: string; profile?: string }
) {
  return await request(key, "/v1/domains", {
    body: { profile: "sending", ...body },
    method: "POST",
  });
}

describe("authentication covers the collection endpoints too", () => {
  // Hono's `/v1/domains/*` does match the bare `/v1/domains`, so these are
  // covered by the same middleware the child routes use. Pinned anyway: it is a
  // routing detail, and if it ever changes the failure is two unauthenticated
  // write endpoints with every other spec still green.
  it.each([
    ["POST", "/v1/domains"],
    ["POST", "/v1/profiles"],
    ["GET", "/v1/domains/anything"],
    ["GET", "/v1/profiles/sending"],
  ])("refuses %s %s without a key", async (method, path) => {
    const response = await app.request(path, {
      body: method === "POST" ? "{}" : undefined,
      headers: { "content-type": "application/json" },
      method,
    });

    expect(response.status).toBe(401);
  });
});

describe("POST /v1/profiles", () => {
  it("creates version 1 and then version 2", async () => {
    const key = await tenantKey("partner");

    const first = await withProfile(key);
    const second = await withProfile(key);

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(first.id).not.toBe(second.id);
  });

  it("refuses a definition the evaluators could never answer", async () => {
    const key = await tenantKey("partner");

    const response = await request(key, "/v1/profiles", {
      body: { key: "web", requirements: [{ check: "caa", key: "caa" }] },
      method: "POST",
    });

    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toContain(
      "must name an issuer"
    );
  });
});

describe("GET /v1/profiles/:key", () => {
  it("returns the newest version", async () => {
    const key = await tenantKey("partner");

    await withProfile(key);
    const second = await withProfile(key);

    const response = await request(key, "/v1/profiles/sending");

    expect((await response.json()).data.id).toBe(second.id);
  });

  it("does not see another tenant's profile of the same name", async () => {
    const first = await tenantKey("first");
    const second = await tenantKey("second");

    await withProfile(first);

    expect((await request(second, "/v1/profiles/sending")).status).toBe(404);
  });
});

describe("POST /v1/domains", () => {
  it("registers without touching DNS at all", async () => {
    // Registration is a write. Importing tens of thousands of domains must not
    // fire tens of thousands of DNS runs as a side effect of a bulk insert.
    const key = await tenantKey("partner");
    await withProfile(key);

    const response = await register(key, { name: "customer.test" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.state).toBe("pending");
    expect(body.data.lastCheckedAt).toBeNull();
    expect(body.data.requirements).toBeNull();
    expect(body.meta.created).toBe(true);
  });

  it("pins the version that was current at registration", async () => {
    const key = await tenantKey("partner");
    const first = await withProfile(key);
    const registered = await (await register(key, { name: "a.test" })).json();

    // Editing the profile afterwards must not move the domain.
    await withProfile(key);
    const reread = await (
      await request(key, `/v1/domains/${registered.data.id}`)
    ).json();

    expect(registered.data.profileVersionId).toBe(first.id);
    expect(reread.data.profileVersionId).toBe(first.id);
  });

  it("returns the existing domain when an external id is re-sent", async () => {
    // A partner's retry, not a second customer. Returning the row removes the
    // mapping table on their side.
    const key = await tenantKey("partner");
    await withProfile(key);

    const first = await (
      await register(key, { externalId: "cust_1", name: "a.test" })
    ).json();
    const again = await register(key, {
      externalId: "cust_1",
      name: "a.test",
    });
    const body = await again.json();

    expect(again.status).toBe(200);
    expect(body.data.id).toBe(first.data.id);
    expect(body.meta.created).toBe(false);
  });

  it("refuses a name already registered under a different external id", async () => {
    // Two records of one domain is not an idempotent retry, and quietly
    // returning one of them hides it.
    const key = await tenantKey("partner");
    await withProfile(key);

    await register(key, { externalId: "cust_1", name: "a.test" });
    const clash = await register(key, { externalId: "cust_2", name: "a.test" });

    expect(clash.status).toBe(409);
    expect((await clash.json()).error.message).toContain("already registered");
  });

  it("lets two tenants register the same domain", async () => {
    // Two platforms can legitimately both be verifying one customer's domain,
    // and neither should be able to detect the other.
    const first = await tenantKey("first");
    const second = await tenantKey("second");
    await withProfile(first);
    await withProfile(second);

    expect((await register(first, { name: "shared.test" })).status).toBe(200);
    expect((await register(second, { name: "shared.test" })).status).toBe(200);
  });

  it("refuses a domain nobody can configure", async () => {
    const key = await tenantKey("partner");
    await withProfile(key);

    const response = await register(key, { name: "co.uk" });

    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toContain("public suffix");
  });

  it("refuses a domain with no profile to check it against", async () => {
    const key = await tenantKey("partner");

    const response = await register(key, { name: "a.test" });

    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toContain("no profile named");
  });

  it("stores one spelling of the name", async () => {
    const key = await tenantKey("partner");
    await withProfile(key);

    const body = await (
      await register(key, { name: "  Customer.TEST.  " })
    ).json();

    expect(body.data.name).toBe("customer.test");
  });
});

describe("tenancy, per route", () => {
  it("hides another tenant's domain from every one of them", async () => {
    // Asserted per route rather than once. A scoping bug is a per-query
    // mistake, and one route forgetting is all it takes.
    const owner = await tenantKey("owner");
    const other = await tenantKey("other");
    await withProfile(owner);
    await withProfile(other);

    const {
      data: { id },
    } = await (await register(owner, { name: "a.test" })).json();

    expect((await request(other, `/v1/domains/${id}`)).status).toBe(404);
    expect((await request(other, `/v1/domains/${id}/timeline`)).status).toBe(
      404
    );
    expect(
      (await request(other, `/v1/domains/${id}/checks`, { method: "POST" }))
        .status
    ).toBe(404);
    expect(
      (await request(other, `/v1/domains/${id}`, { method: "DELETE" })).status
    ).toBe(404);
  });

  it("leaves the domain in place after another tenant tries to delete it", async () => {
    const owner = await tenantKey("owner");
    const other = await tenantKey("other");
    await withProfile(owner);
    await withProfile(other);

    const mine = await (await register(owner, { name: "a.test" })).json();

    await request(other, `/v1/domains/${mine.data.id}`, { method: "DELETE" });

    expect((await request(owner, `/v1/domains/${mine.data.id}`)).status).toBe(
      200
    );
  });
});

describe("DELETE /v1/domains/:id", () => {
  it("stops tracking, so milestone 2's sweeper does not inherit it", async () => {
    const key = await tenantKey("partner");
    await withProfile(key);
    const mine = await (await register(key, { name: "a.test" })).json();

    const deleted = await request(key, `/v1/domains/${mine.data.id}`, {
      method: "DELETE",
    });

    expect(deleted.status).toBe(200);
    expect((await request(key, `/v1/domains/${mine.data.id}`)).status).toBe(
      404
    );
  });

  it("is a 404 the second time, rather than pretending", async () => {
    const key = await tenantKey("partner");

    expect(
      (await request(key, "/v1/domains/nope", { method: "DELETE" })).status
    ).toBe(404);
  });
});

describe("GET /v1/domains/:id/timeline", () => {
  it("is empty for a domain nobody has checked", async () => {
    const key = await tenantKey("partner");
    await withProfile(key);
    const mine = await (await register(key, { name: "a.test" })).json();

    const response = await request(key, `/v1/domains/${mine.data.id}/timeline`);

    expect((await response.json()).data).toEqual([]);
  });
});
