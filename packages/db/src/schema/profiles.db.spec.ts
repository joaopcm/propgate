import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../client";
import { truncateAll } from "../test/truncate";
import type { ProfileDefinition } from "./profiles";
import { profiles } from "./profiles";
import { tenants } from "./tenants";

const db = createDb(process.env.DATABASE_URL ?? "", { maxConnections: 2 });

const DEFINITION: ProfileDefinition = {
  requirements: [
    { check: "spf", include: "_spf.partner.example", key: "spf" },
    { check: "dkim", key: "dkim", selector: "pg1" },
  ],
};

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function tenant(): Promise<string> {
  const [row] = await db.insert(tenants).values({ name: "t" }).returning();

  return String(row?.id);
}

describe("profiles", () => {
  it("keeps every version rather than overwriting", async () => {
    const tenantId = await tenant();

    await db
      .insert(profiles)
      .values({ definition: DEFINITION, key: "sending", tenantId, version: 1 });
    await db
      .insert(profiles)
      .values({ definition: DEFINITION, key: "sending", tenantId, version: 2 });

    expect(await db.select().from(profiles)).toHaveLength(2);
  });

  it("refuses the same version twice for one key", async () => {
    const tenantId = await tenant();
    const row = {
      definition: DEFINITION,
      key: "sending",
      tenantId,
      version: 1,
    };

    await db.insert(profiles).values(row);

    await expect(db.insert(profiles).values(row)).rejects.toThrow();
  });

  it("lets two tenants use the same profile key", async () => {
    // The key is a tenant's own name for the profile, not a global identifier.
    // Making it globally unique would mean the second tenant to want "sending"
    // could not have it.
    const first = await tenant();
    const second = await tenant();

    await db.insert(profiles).values({
      definition: DEFINITION,
      key: "sending",
      tenantId: first,
      version: 1,
    });
    await db.insert(profiles).values({
      definition: DEFINITION,
      key: "sending",
      tenantId: second,
      version: 1,
    });

    expect(await db.select().from(profiles)).toHaveLength(2);
  });

  it("round-trips the definition without losing its shape", async () => {
    const tenantId = await tenant();

    const [row] = await db
      .insert(profiles)
      .values({ definition: DEFINITION, key: "sending", tenantId, version: 1 })
      .returning();

    expect(row?.definition.requirements[0]?.include).toBe(
      "_spf.partner.example"
    );
    expect(row?.definition.requirements[1]?.selector).toBe("pg1");
  });
});
