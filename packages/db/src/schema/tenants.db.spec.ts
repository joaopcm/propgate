import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../client";
import { truncateAll } from "../test/truncate";
import { apiKeys } from "./api-keys";
import { tenants } from "./tenants";

const db = createDb(process.env.DATABASE_URL ?? "", { maxConnections: 2 });

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("tenants and keys", () => {
  it("gives every row a sortable id without being told", async () => {
    // uuidv7 is time-ordered, so inserting in sequence yields ids that sort in
    // insertion order. That is the whole reason to prefer it over a random uuid.
    const [first] = await db
      .insert(tenants)
      .values({ name: "one" })
      .returning();
    const [second] = await db
      .insert(tenants)
      .values({ name: "two" })
      .returning();

    expect(first?.id).toBeDefined();
    expect(second?.id).toBeDefined();
    expect(String(first?.id) < String(second?.id)).toBe(true);
  });

  it("refuses two keys with the same hash", async () => {
    const [tenant] = await db.insert(tenants).values({ name: "t" }).returning();
    const row = {
      hashedKey: "same",
      name: "k",
      prefix: "pg_live_aaaa",
      tenantId: String(tenant?.id),
    };

    await db.insert(apiKeys).values(row);

    await expect(db.insert(apiKeys).values(row)).rejects.toThrow();
  });

  it("takes a tenant's keys with it when the tenant goes", async () => {
    // Cascade rather than a nullable tenant: a key with no tenant authenticates
    // as nobody, and every later query would have to decide what that means.
    const [tenant] = await db.insert(tenants).values({ name: "t" }).returning();
    const tenantId = String(tenant?.id);

    await db
      .insert(apiKeys)
      .values({ hashedKey: "h", name: "k", prefix: "pg_live_bbbb", tenantId });

    await db.delete(tenants).where(eq(tenants.id, tenantId));

    expect(await db.select().from(apiKeys)).toEqual([]);
  });
});
