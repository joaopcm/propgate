import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client";
import { createDb } from "../client";
import { domains } from "../schema/domains";
import { profiles } from "../schema/profiles";
import { tenants } from "../schema/tenants";
import { truncateAll } from "../test/truncate";
import { createProfileVersion } from "./profiles";
import { claimDueDomains, dueCount } from "./sweep";

const db: Database = createDb(process.env.DATABASE_URL ?? "", {
  maxConnections: 6,
});

const NOW = new Date("2026-08-03T12:00:00.000Z");
const PAST = new Date("2026-08-03T11:00:00.000Z");
const FUTURE = new Date("2026-08-03T13:00:00.000Z");

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function seed(
  count: number,
  nextCheckAt: Date
): Promise<{ ids: string[]; tenantId: string }> {
  const [tenant] = await db
    .insert(tenants)
    .values({ name: "partner" })
    .returning();
  const tenantId = String(tenant?.id);

  const profile = await createProfileVersion(db, {
    definition: { requirements: [] },
    key: "sending",
    tenantId,
  });

  const inserted = await db
    .insert(domains)
    .values(
      Array.from({ length: count }, (_unused, index) => ({
        name: `d${index}.test`,
        nextCheckAt,
        profileVersionId: profile.id,
        tenantId,
      }))
    )
    .returning({ id: domains.id });

  return { ids: inserted.map((row) => row.id), tenantId };
}

describe("claimDueDomains", () => {
  it("claims a domain whose next check is in the past", async () => {
    const { ids } = await seed(1, PAST);

    const claimed = await claimDueDomains(
      db,
      { leaseSeconds: 300, limit: 10 },
      NOW
    );

    expect(claimed.map((row) => row.id)).toEqual(ids);
  });

  it("leaves a domain that is not due yet alone", async () => {
    await seed(1, FUTURE);

    const claimed = await claimDueDomains(
      db,
      { leaseSeconds: 300, limit: 10 },
      NOW
    );

    expect(claimed).toEqual([]);
  });

  it("pushes the claimed row out by the lease, so it cannot be claimed twice", async () => {
    await seed(1, PAST);

    const first = await claimDueDomains(
      db,
      { leaseSeconds: 300, limit: 10 },
      NOW
    );
    const second = await claimDueDomains(
      db,
      { leaseSeconds: 300, limit: 10 },
      NOW
    );

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it("makes the row due again once the lease has lapsed", async () => {
    await seed(1, PAST);

    await claimDueDomains(db, { leaseSeconds: 300, limit: 10 }, NOW);

    const afterLease = new Date(NOW.getTime() + 301_000);
    const reclaimed = await claimDueDomains(
      db,
      { leaseSeconds: 300, limit: 10 },
      afterLease
    );

    expect(reclaimed).toHaveLength(1);
  });

  it("does not claim more than the limit", async () => {
    await seed(5, PAST);

    const claimed = await claimDueDomains(
      db,
      { leaseSeconds: 300, limit: 2 },
      NOW
    );

    expect(claimed).toHaveLength(2);
  });

  it("gives two concurrent claims disjoint sets", async () => {
    const { ids } = await seed(20, PAST);

    const [first, second] = await Promise.all([
      claimDueDomains(db, { leaseSeconds: 300, limit: 10 }, NOW),
      claimDueDomains(db, { leaseSeconds: 300, limit: 10 }, NOW),
    ]);

    const claimed = [...first, ...second].map((row) => row.id);

    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed).toHaveLength(ids.length);
  });

  it("returns identifiers and nothing else", async () => {
    await seed(1, PAST);

    const [claimed] = await claimDueDomains(
      db,
      { leaseSeconds: 300, limit: 1 },
      NOW
    );

    expect(Object.keys(claimed ?? {}).sort()).toEqual(["id", "tenantId"]);
  });
});

describe("dueCount", () => {
  it("counts only what is due", async () => {
    await seed(3, PAST);
    await db
      .insert(domains)
      .values({
        name: "later.test",
        nextCheckAt: FUTURE,
        profileVersionId: String(
          (await db.select({ id: profiles.id }).from(profiles).limit(1))[0]?.id
        ),
        tenantId: String(
          (await db.select({ id: tenants.id }).from(tenants).limit(1))[0]?.id
        ),
      })
      .returning();

    expect(await dueCount(db, NOW)).toBe(3);
  });

  it("is zero once everything has been claimed", async () => {
    await seed(2, PAST);

    await claimDueDomains(db, { leaseSeconds: 300, limit: 10 }, NOW);

    expect(await dueCount(db, NOW)).toBe(0);
  });
});
