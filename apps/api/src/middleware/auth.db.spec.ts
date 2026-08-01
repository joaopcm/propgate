import {
  createApiKey,
  createDb,
  revokeApiKey,
  tenants,
  truncateAll,
} from "@propgate/db";
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthVariables } from "./auth";
import { bearerAuth } from "./auth";

const db = createDb(process.env.DATABASE_URL ?? "", { maxConnections: 2 });

/**
 * A throwaway app rather than the real one, because there are no authenticated
 * routes yet — the middleware lands before the routes that need it, which is
 * the point of doing it in its own PR.
 */
function appWithAuth() {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.use("/protected", bearerAuth(db));
  app.get("/protected", (c) =>
    c.json({ apiKeyId: c.get("apiKeyId"), tenantId: c.get("tenantId") })
  );

  return app;
}

async function keyFor(name: string): Promise<{
  key: string;
  tenantId: string;
}> {
  const [tenant] = await db.insert(tenants).values({ name }).returning();
  const tenantId = String(tenant?.id);
  const created = await createApiKey(db, { name: "k", tenantId });

  return { key: created.key, tenantId };
}

function get(app: Hono<{ Variables: AuthVariables }>, authorization?: string) {
  return app.request(
    "/protected",
    authorization === undefined ? {} : { headers: { authorization } }
  );
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("bearerAuth", () => {
  it("puts the key's tenant on the context", async () => {
    const { key, tenantId } = await keyFor("partner");

    const response = await get(appWithAuth(), `Bearer ${key}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ tenantId });
  });

  it("never lets one tenant's key resolve to another tenant", async () => {
    // The property every route-level tenancy check is built on. If the tenant
    // on the context is wrong, scoping a query by it scopes it to the wrong
    // customer's data.
    const first = await keyFor("first");
    const second = await keyFor("second");

    const one = await (await get(appWithAuth(), `Bearer ${first.key}`)).json();
    const two = await (await get(appWithAuth(), `Bearer ${second.key}`)).json();

    expect(one).toMatchObject({ tenantId: first.tenantId });
    expect(two).toMatchObject({ tenantId: second.tenantId });
    expect(first.tenantId).not.toBe(second.tenantId);
  });

  it("says what a caller with no header should have sent", async () => {
    const response = await get(appWithAuth());
    const body = await response.json();

    expect(response.status).toBe(401);
    // An agent can fix this. "Unauthorized" alone it cannot.
    expect(body.error.message).toContain("Bearer pg_live_");
  });

  it("rejects a scheme that is not Bearer", async () => {
    const { key } = await keyFor("partner");

    const response = await get(appWithAuth(), `Basic ${key}`);

    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toContain("Bearer scheme");
  });

  it("accepts the scheme in any case, as RFC 7235 requires", async () => {
    const { key } = await keyFor("partner");

    expect((await get(appWithAuth(), `bearer ${key}`)).status).toBe(200);
    expect((await get(appWithAuth(), `BEARER ${key}`)).status).toBe(200);
  });

  it("rejects a key nobody issued", async () => {
    const response = await get(appWithAuth(), "Bearer pg_live_nope");

    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe("invalid API key");
  });

  it("tells a revoked key apart from a wrong one", async () => {
    const [tenant] = await db.insert(tenants).values({ name: "t" }).returning();
    const created = await createApiKey(db, {
      name: "k",
      tenantId: String(tenant?.id),
    });

    await revokeApiKey(db, created.id);

    const response = await get(appWithAuth(), `Bearer ${created.key}`);

    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toContain("revoked");
  });

  it("answers in the same envelope every other route uses", async () => {
    const response = await get(appWithAuth());

    expect(await response.json()).toEqual({
      data: null,
      error: { message: expect.any(String) },
      meta: null,
    });
  });
});
