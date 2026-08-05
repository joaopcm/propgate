import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../client";
import { apiKeys } from "../schema/api-keys";
import { tenants } from "../schema/tenants";
import { truncateAll } from "../test/truncate";
import { authenticateApiKey, createApiKey, revokeApiKey } from "./api-keys";

const db = createDb(process.env.DATABASE_URL ?? "", { maxConnections: 2 });

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function tenant(name: string): Promise<string> {
  const [row] = await db.insert(tenants).values({ name }).returning();

  return String(row?.id);
}

describe("createApiKey", () => {
  it("stores the hash and the prefix, never the key", async () => {
    const tenantId = await tenant("t");

    const created = await createApiKey(db, { name: "prod", tenantId });
    const [stored] = await db.select().from(apiKeys);

    expect(stored?.hashedKey).toBe(created.hashedKey);
    expect(stored?.prefix).toBe(created.prefix);
    // Losing the database must not lose the keys.
    expect(JSON.stringify(stored)).not.toContain(created.key);
  });
});

describe("authenticateApiKey", () => {
  it("resolves a key to the tenant that owns it", async () => {
    const tenantId = await tenant("t");
    const created = await createApiKey(db, { name: "prod", tenantId });

    const outcome = await authenticateApiKey(db, created.key);

    expect(outcome).toEqual({
      authenticated: {
        apiKeyId: created.id,
        requestQuotaPerSecond: null,
        tenantId,
      },
      ok: true,
    });
  });

  it("carries the tenant's rate-limit override", async () => {
    const tenantId = await tenant("vetted");

    await db
      .update(tenants)
      .set({ requestQuotaPerSecond: 2000 })
      .where(eq(tenants.id, tenantId));

    const created = await createApiKey(db, { name: "prod", tenantId });
    const outcome = await authenticateApiKey(db, created.key);

    // Raising a partner's ceiling is a row update and nothing else. If this
    // stops being carried out of authentication, the column silently becomes
    // decoration and the only symptom is a partner hitting a limit they were
    // told they did not have.
    expect(outcome.ok && outcome.authenticated.requestQuotaPerSecond).toBe(
      2000
    );
  });

  it("keeps two tenants' keys apart", async () => {
    // The isolation property everything above this depends on. If it fails
    // here, every route-level tenancy check is checking the wrong tenant.
    const first = await tenant("first");
    const second = await tenant("second");
    const firstKey = await createApiKey(db, {
      name: "k",
      tenantId: first,
    });
    const secondKey = await createApiKey(db, {
      name: "k",
      tenantId: second,
    });

    const one = await authenticateApiKey(db, firstKey.key);
    const two = await authenticateApiKey(db, secondKey.key);

    expect(one.ok && one.authenticated.tenantId).toBe(first);
    expect(two.ok && two.authenticated.tenantId).toBe(second);
  });

  it("rejects a key nobody issued", async () => {
    const outcome = await authenticateApiKey(db, "pg_live_not-a-real-key");

    expect(outcome).toEqual({ ok: false, reason: "unknown" });
  });

  it("tells a revoked key apart from an unknown one", async () => {
    const tenantId = await tenant("t");
    const created = await createApiKey(db, { name: "prod", tenantId });

    await revokeApiKey(db, created.id);

    expect(await authenticateApiKey(db, created.key)).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("records first use", async () => {
    const tenantId = await tenant("t");
    const created = await createApiKey(db, { name: "prod", tenantId });

    await authenticateApiKey(db, created.key);

    const [row] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, created.id));

    expect(row?.lastUsedAt).not.toBeNull();
  });

  it("does not rewrite last_used_at on every request", async () => {
    // A write per request for a column nobody reads at second resolution. At a
    // partner's import rate that is thousands of row versions a minute.
    const tenantId = await tenant("t");
    const created = await createApiKey(db, { name: "prod", tenantId });
    const first = new Date("2026-08-01T12:00:00.000Z");

    await authenticateApiKey(db, created.key, first);
    await authenticateApiKey(db, created.key, new Date("2026-08-01T12:00:30Z"));

    const [row] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, created.id));

    expect(row?.lastUsedAt).toEqual(first);
  });

  it("moves last_used_at once the reading is genuinely stale", async () => {
    const tenantId = await tenant("t");
    const created = await createApiKey(db, { name: "prod", tenantId });
    const later = new Date("2026-08-01T12:05:00.000Z");

    await authenticateApiKey(db, created.key, new Date("2026-08-01T12:00:00Z"));
    await authenticateApiKey(db, created.key, later);

    const [row] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, created.id));

    expect(row?.lastUsedAt).toEqual(later);
  });
});
