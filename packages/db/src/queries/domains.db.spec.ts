import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../client";
import { domains } from "../schema/domains";
import type { ProfileDefinition } from "../schema/profiles";
import { profiles } from "../schema/profiles";
import { tenants } from "../schema/tenants";
import { truncateAll } from "../test/truncate";
import {
  domainById,
  listDomains,
  registerDomain,
  saveCheck,
  updateDomainConfig,
} from "./domains";

const db = createDb(process.env.DATABASE_URL ?? "", { maxConnections: 2 });

const DEFINITION: ProfileDefinition = {
  requirements: [
    {
      check: "dkim",
      key: "dkim",
      requiredPerDomain: ["expectedPublicKey"],
      selector: "pg1",
    },
  ],
};

const KEY = `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA${"AbCdEf01234+/".repeat(
  28
)}IDAQAB`;

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function tenantAndProfiles(): Promise<{
  other: string;
  sending: string;
  tenantId: string;
}> {
  const [tenant] = await db.insert(tenants).values({ name: "t" }).returning();
  const tenantId = String(tenant?.id);
  const [sending] = await db
    .insert(profiles)
    .values({ definition: DEFINITION, key: "sending", tenantId, version: 1 })
    .returning();
  const [other] = await db
    .insert(profiles)
    .values({
      definition: { requirements: [{ check: "dmarc", key: "dmarc" }] },
      key: "web",
      tenantId,
      version: 1,
    })
    .returning();

  return {
    other: String(other?.id),
    sending: String(sending?.id),
    tenantId,
  };
}

describe("expectations in storage", () => {
  it("round-trips a full-size key byte for byte", async () => {
    const { sending, tenantId } = await tenantAndProfiles();

    const created = await registerDomain(db, {
      expectations: { dkim: { expectedPublicKey: KEY } },
      name: "example.com",
      profileVersionId: sending,
      tenantId,
    });

    expect(created.kind).toBe("created");

    const read = await domainById(
      db,
      tenantId,
      created.kind === "created" ? created.domain.id : ""
    );

    expect(read?.expectations).toEqual({ dkim: { expectedPublicKey: KEY } });
    expect(KEY.length).toBeGreaterThan(400);
  });

  it("stamps configChangedAt at registration", async () => {
    const { sending, tenantId } = await tenantAndProfiles();

    const created = await registerDomain(db, {
      name: "example.com",
      profileVersionId: sending,
      tenantId,
    });

    expect(
      created.kind === "created" ? created.domain.configChangedAt : null
    ).toBeInstanceOf(Date);
  });

  it("reads back a row that predates the columns without throwing", async () => {
    const { sending, tenantId } = await tenantAndProfiles();
    const [row] = await db
      .insert(domains)
      .values({ name: "old.example", profileVersionId: sending, tenantId })
      .returning();

    const read = await domainById(db, tenantId, String(row?.id));

    expect(read?.expectations).toBeNull();
    expect(read?.configChangedAt).toBeNull();
  });

  it("ignores expectations on a re-registration rather than rewriting them", async () => {
    const { sending, tenantId } = await tenantAndProfiles();
    await registerDomain(db, {
      expectations: { dkim: { expectedPublicKey: "original" } },
      externalId: "cus_1",
      name: "example.com",
      profileVersionId: sending,
      tenantId,
    });

    const again = await registerDomain(db, {
      expectations: { dkim: { expectedPublicKey: "rotated" } },
      externalId: "cus_1",
      name: "example.com",
      profileVersionId: sending,
      tenantId,
    });

    expect(again.kind).toBe("existing");
    expect(
      again.kind === "existing" ? again.domain.expectations : null
    ).toEqual({ dkim: { expectedPublicKey: "original" } });
  });

  it("keeps expectations off the list, where the page budget lives", async () => {
    const { sending, tenantId } = await tenantAndProfiles();
    await registerDomain(db, {
      expectations: { dkim: { expectedPublicKey: KEY } },
      name: "example.com",
      profileVersionId: sending,
      tenantId,
    });

    const page = await listDomains(db, tenantId, { limit: 10 });

    expect(page.domains).toHaveLength(1);
    expect("expectations" in (page.domains[0] ?? {})).toBe(false);
  });
});

async function registered(): Promise<{
  configChangedAt: Date | null;
  id: string;
  other: string;
  tenantId: string;
}> {
  const { other, sending, tenantId } = await tenantAndProfiles();
  const created = await registerDomain(db, {
    expectations: { dkim: { expectedPublicKey: "original" } },
    name: "example.com",
    profileVersionId: sending,
    tenantId,
  });

  if (created.kind !== "created") {
    throw new Error(`expected a fresh domain, got ${created.kind}`);
  }

  return {
    configChangedAt: created.domain.configChangedAt,
    id: created.domain.id,
    other,
    tenantId,
  };
}

describe("saveCheck", () => {
  it("writes when the configuration has not moved", async () => {
    const { configChangedAt, id, tenantId } = await registered();

    const saved = await saveCheck(db, {
      configChangedAt,
      consecutiveFailures: 0,
      domainId: id,
      nextCheckAt: new Date(Date.now() + 86_400_000),
      result: {
        checkedAt: new Date().toISOString(),
        requirements: [],
        verdict: "pass",
      },
      state: "verified",
      tenantId,
    });

    expect(saved).toBe(true);
    expect((await domainById(db, tenantId, id))?.state).toBe("verified");
  });

  it("refuses to write a result computed before a configuration change", async () => {
    const { configChangedAt, id, tenantId } = await registered();

    await updateDomainConfig(db, tenantId, id, {
      expectations: { dkim: { expectedPublicKey: "rotated" } },
    });

    const saved = await saveCheck(db, {
      configChangedAt,
      consecutiveFailures: 0,
      domainId: id,
      nextCheckAt: new Date(Date.now() + 86_400_000),
      result: {
        checkedAt: new Date().toISOString(),
        requirements: [],
        verdict: "pass",
      },
      state: "verified",
      tenantId,
    });

    expect(saved).toBe(false);

    const after = await domainById(db, tenantId, id);

    expect(after?.state).toBe("pending");
    expect(after?.lastResult).toBeNull();
    expect(after?.expectations).toEqual({
      dkim: { expectedPublicKey: "rotated" },
    });
  });

  it("writes against a row that predates the column", async () => {
    const { sending, tenantId } = await tenantAndProfiles();
    const [row] = await db
      .insert(domains)
      .values({ name: "old.example", profileVersionId: sending, tenantId })
      .returning();
    const id = String(row?.id);

    const saved = await saveCheck(db, {
      configChangedAt: null,
      consecutiveFailures: 0,
      domainId: id,
      nextCheckAt: new Date(Date.now() + 86_400_000),
      result: {
        checkedAt: new Date().toISOString(),
        requirements: [],
        verdict: "pass",
      },
      state: "verified",
      tenantId,
    });

    expect(saved).toBe(true);
  });
});

describe("updateDomainConfig", () => {
  async function verified(): Promise<{
    id: string;
    other: string;
    tenantId: string;
  }> {
    const { configChangedAt, id, other, tenantId } = await registered();

    await saveCheck(db, {
      configChangedAt,
      consecutiveFailures: 2,
      domainId: id,
      nextCheckAt: new Date(Date.now() + 86_400_000),
      result: {
        checkedAt: new Date().toISOString(),
        requirements: [],
        verdict: "pass",
      },
      state: "verified",
      tenantId,
    });

    return { id, other, tenantId };
  }

  it("resets to pending and clears the failure run when values change", async () => {
    const { id, tenantId } = await verified();

    const updated = await updateDomainConfig(db, tenantId, id, {
      expectations: { dkim: { expectedPublicKey: "rotated" } },
    });

    expect(updated?.state).toBe("pending");
    expect(updated?.consecutiveFailures).toBe(0);
    expect(updated?.expectations).toEqual({
      dkim: { expectedPublicKey: "rotated" },
    });
    expect(updated?.configChangedAt).toBeInstanceOf(Date);
  });

  it("makes the domain due, so the reset is not merely cosmetic", async () => {
    const { id, tenantId } = await verified();
    const before = await domainById(db, tenantId, id);

    expect((before?.nextCheckAt?.getTime() ?? 0) - Date.now()).toBeGreaterThan(
      23 * 3600 * 1000
    );

    const updated = await updateDomainConfig(db, tenantId, id, {
      expectations: { dkim: { expectedPublicKey: "rotated" } },
    });

    expect((updated?.nextCheckAt?.getTime() ?? 0) - Date.now()).toBeLessThan(
      1000
    );
  });

  it("re-points to another profile version and resets the same way", async () => {
    const { id, other, tenantId } = await verified();

    const updated = await updateDomainConfig(db, tenantId, id, {
      profileVersionId: other,
    });

    expect(updated?.profileVersionId).toBe(other);
    expect(updated?.state).toBe("pending");
    expect(updated?.consecutiveFailures).toBe(0);
  });

  it("leaves values alone when only the profile moves", async () => {
    const { id, other, tenantId } = await verified();

    const updated = await updateDomainConfig(db, tenantId, id, {
      profileVersionId: other,
    });

    expect(updated?.expectations).toEqual({
      dkim: { expectedPublicKey: "original" },
    });
  });

  it("writes both when both are supplied", async () => {
    const { id, other, tenantId } = await verified();

    const updated = await updateDomainConfig(db, tenantId, id, {
      expectations: { dkim: { expectedPublicKey: "rotated" } },
      profileVersionId: other,
    });

    expect(updated?.profileVersionId).toBe(other);
    expect(updated?.expectations).toEqual({
      dkim: { expectedPublicKey: "rotated" },
    });
  });

  it("cannot reach another tenant's domain", async () => {
    const { id } = await verified();
    const [outsider] = await db
      .insert(tenants)
      .values({ name: "other" })
      .returning();

    const updated = await updateDomainConfig(db, String(outsider?.id), id, {
      expectations: { dkim: { expectedPublicKey: "stolen" } },
    });

    expect(updated).toBeUndefined();
  });
});
