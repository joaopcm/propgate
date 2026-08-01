import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../client";
import { truncateAll } from "../test/truncate";
import { domains } from "./domains";
import type { ProfileDefinition } from "./profiles";
import { profiles } from "./profiles";
import { tenants } from "./tenants";

const db = createDb(process.env.DATABASE_URL ?? "", { maxConnections: 2 });

const DEFINITION: ProfileDefinition = {
  requirements: [{ check: "spf", include: "_spf.partner.example", key: "spf" }],
};

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function fixture(): Promise<{ profileId: string; tenantId: string }> {
  const [tenant] = await db.insert(tenants).values({ name: "t" }).returning();
  const tenantId = String(tenant?.id);
  const [profile] = await db
    .insert(profiles)
    .values({ definition: DEFINITION, key: "sending", tenantId, version: 1 })
    .returning();

  return { profileId: String(profile?.id), tenantId };
}

describe("domains", () => {
  it("starts pending without being told", async () => {
    const { profileId, tenantId } = await fixture();

    const [row] = await db
      .insert(domains)
      .values({ name: "example.com", profileVersionId: profileId, tenantId })
      .returning();

    expect(row?.state).toBe("pending");
    expect(row?.lastCheckedAt).toBeNull();
    expect(row?.nextCheckAt).toBeNull();
  });

  it("accepts all five states, including the two nothing reaches yet", async () => {
    // The enum exists in full from the first migration so milestone 2 adds a
    // transition rather than migrating an enum under live rows.
    const { profileId, tenantId } = await fixture();
    const states = [
      "pending",
      "verifying",
      "verified",
      "degraded",
      "failed",
    ] as const;

    const rows = await db
      .insert(domains)
      .values(
        states.map((state) => ({
          name: `${state}.example.com`,
          profileVersionId: profileId,
          state,
          tenantId,
        }))
      )
      .returning();

    expect(rows.map((row) => row.state)).toEqual([...states]);
  });

  it("refuses the same name twice for one tenant", async () => {
    const { profileId, tenantId } = await fixture();
    const row = {
      name: "example.com",
      profileVersionId: profileId,
      tenantId,
    };

    await db.insert(domains).values(row);

    await expect(db.insert(domains).values(row)).rejects.toThrow();
  });

  it("lets two tenants watch the same domain", async () => {
    // Two platforms can legitimately both be verifying one customer's domain,
    // and neither should be able to detect the other.
    const first = await fixture();
    const second = await fixture();

    await db.insert(domains).values({
      name: "example.com",
      profileVersionId: first.profileId,
      tenantId: first.tenantId,
    });
    await db.insert(domains).values({
      name: "example.com",
      profileVersionId: second.profileId,
      tenantId: second.tenantId,
    });

    expect(await db.select().from(domains)).toHaveLength(2);
  });

  it("refuses a duplicate external id within a tenant", async () => {
    const { profileId, tenantId } = await fixture();

    await db.insert(domains).values({
      externalId: "cust_1",
      name: "a.example.com",
      profileVersionId: profileId,
      tenantId,
    });

    await expect(
      db.insert(domains).values({
        externalId: "cust_1",
        name: "b.example.com",
        profileVersionId: profileId,
        tenantId,
      })
    ).rejects.toThrow();
  });

  it("allows many domains with no external id at all", async () => {
    // Postgres treats NULLs as distinct in a unique index, which is the
    // behaviour we want: external_id is optional and two domains without one
    // are not duplicates.
    const { profileId, tenantId } = await fixture();

    await db.insert(domains).values({
      name: "a.example.com",
      profileVersionId: profileId,
      tenantId,
    });
    await db.insert(domains).values({
      name: "b.example.com",
      profileVersionId: profileId,
      tenantId,
    });

    expect(await db.select().from(domains)).toHaveLength(2);
  });

  it("will not let a profile version be deleted out from under a domain", async () => {
    // No cascade here on purpose: a domain pinned to a version that vanished
    // cannot be re-evaluated, and losing that silently is worse than an error.
    const { profileId, tenantId } = await fixture();

    await db.insert(domains).values({
      name: "example.com",
      profileVersionId: profileId,
      tenantId,
    });

    await expect(db.delete(profiles)).rejects.toThrow();
  });
});
