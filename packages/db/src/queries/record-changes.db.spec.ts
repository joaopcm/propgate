import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../client";
import { domains } from "../schema/domains";
import type { ProfileDefinition } from "../schema/profiles";
import { profiles } from "../schema/profiles";
import { recordChanges } from "../schema/record-changes";
import { tenants } from "../schema/tenants";
import { truncateAll } from "../test/truncate";
import { recordObservation } from "./record-changes";

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

async function domain(): Promise<string> {
  const [tenant] = await db.insert(tenants).values({ name: "t" }).returning();
  const tenantId = String(tenant?.id);
  const [profile] = await db
    .insert(profiles)
    .values({ definition: DEFINITION, key: "sending", tenantId, version: 1 })
    .returning();
  const [row] = await db
    .insert(domains)
    .values({
      name: "example.com",
      profileVersionId: String(profile?.id),
      tenantId,
    })
    .returning();

  return String(row?.id);
}

describe("recordObservation", () => {
  it("appends the first sighting with no previous value", async () => {
    const domainId = await domain();

    const outcome = await recordObservation(db, {
      domainId,
      observed: "v=spf1 include:a -all",
      requirementKey: "spf",
    });

    const rows = await db.select().from(recordChanges);

    expect(outcome).toBe("changed");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.previous).toBeNull();
    expect(rows[0]?.current).toBe("v=spf1 include:a -all");
  });

  it("writes nothing when the value is unchanged", async () => {
    // The assertion the bill depends on. A sweep that observes the same value
    // six times a day must not write six rows.
    const domainId = await domain();
    const observed = "v=spf1 include:a -all";

    await recordObservation(db, { domainId, observed, requirementKey: "spf" });
    const outcome = await recordObservation(db, {
      domainId,
      observed,
      requirementKey: "spf",
    });

    expect(outcome).toBe("unchanged");
    expect(await db.select().from(recordChanges)).toHaveLength(1);
  });

  it("appends when the value actually changes, carrying the old one", async () => {
    const domainId = await domain();

    await recordObservation(db, {
      domainId,
      observed: "old",
      requirementKey: "spf",
    });
    await recordObservation(db, {
      domainId,
      observed: "new",
      requirementKey: "spf",
    });

    const rows = await db
      .select()
      .from(recordChanges)
      .orderBy(recordChanges.id);

    expect(rows).toHaveLength(2);
    expect(rows[1]?.previous).toBe("old");
    expect(rows[1]?.current).toBe("new");
  });

  it("treats a record disappearing as a change", async () => {
    // Deletion is the change people most want to see in a timeline, and a null
    // observation is how it arrives.
    const domainId = await domain();

    await recordObservation(db, {
      domainId,
      observed: "something",
      requirementKey: "spf",
    });
    const outcome = await recordObservation(db, {
      domainId,
      observed: null,
      requirementKey: "spf",
    });

    expect(outcome).toBe("changed");
    expect(await db.select().from(recordChanges)).toHaveLength(2);
  });

  it("does not append twice for a value that stays absent", async () => {
    const domainId = await domain();

    await recordObservation(db, {
      domainId,
      observed: null,
      requirementKey: "spf",
    });
    const outcome = await recordObservation(db, {
      domainId,
      observed: null,
      requirementKey: "spf",
    });

    expect(outcome).toBe("unchanged");
    expect(await db.select().from(recordChanges)).toHaveLength(1);
  });

  it("keeps requirements independent", async () => {
    const domainId = await domain();

    await recordObservation(db, {
      domainId,
      observed: "x",
      requirementKey: "spf",
    });
    await recordObservation(db, {
      domainId,
      observed: "x",
      requirementKey: "dkim",
    });

    // Same value, different requirement — two first sightings, not a no-op.
    expect(await db.select().from(recordChanges)).toHaveLength(2);
  });
});
