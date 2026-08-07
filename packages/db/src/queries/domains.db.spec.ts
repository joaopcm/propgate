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

/**
 * The storage half of per-domain expectations.
 *
 * A DKIM key is the largest value this schema carries and the one where a
 * storage layer is most likely to bite — so the round trip is asserted against
 * real Postgres rather than assumed from the type.
 */

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

/** A 2048-bit key's worth of base64: the real size, not a short stand-in. */
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
    // Registration *is* the config being set, and this column is what the
    // fast-pending window is measured from.
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
    /**
     * Every existing domain, at migration time.
     *
     * Both columns are nullable with no backfill, and null must mean "nothing
     * supplied, nothing needed" rather than an error — a default of `{}` later
     * read as a fault would break every row that already existed.
     */
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
    /**
     * The `existing` branch writes nothing, deliberately.
     *
     * It is there so a partner's retry or a re-run import is harmless. Letting it
     * update values would turn a replayed bulk import into a silent rewrite of
     * live expectations — so rotating a key is `PATCH`, and this test is named
     * for the behaviour so nobody "fixes" it later.
     */
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
    // 389 bytes a domain, two hundred a page. One key would roughly double that
    // for a field nothing on the list renders.
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

/** A registered domain and the `configChangedAt` a check would have read. */
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
    /**
     * The race a rotation opens. A check reads the domain, spends up to ten
     * seconds on DNS, and a `PATCH` lands in the middle.
     *
     * Without the compare-and-set this write wins: the row goes `verified` for a
     * key nothing has ever checked, the pending reset the customer asked for is
     * gone, and `expectationsFingerprint` records a value the row no longer holds.
     * The check is simply answering a question nobody is asking any more.
     */
    const { configChangedAt, id, tenantId } = await registered();

    await updateDomainConfig(db, tenantId, id, {
      expectations: { dkim: { expectedPublicKey: "rotated" } },
    });

    const saved = await saveCheck(db, {
      // As it was read, before the PATCH.
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

    // The reset stands, and the domain is still due, so the next tick asks again.
    expect(after?.state).toBe("pending");
    expect(after?.lastResult).toBeNull();
    expect(after?.expectations).toEqual({
      dkim: { expectedPublicKey: "rotated" },
    });
  });

  it("writes against a row that predates the column", async () => {
    // `null` is not a value SQL equality matches, so the guard needs the other
    // spelling for every domain that existed before the column did.
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
    /**
     * The whole reason this function exists.
     *
     * Without the reset, the next check compares a freshly issued key against a
     * zone that has not been updated yet, hysteresis reads one definite failure,
     * and a `domain.degraded` webhook goes out claiming the customer's DNS broke.
     * Across a fleet rotation that is one false page per domain.
     */
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
    /**
     * A verified domain is scheduled a day out.
     *
     * Without moving `next_check_at`, going back to `pending` changes a word in
     * the row and nothing else: the sweeper would not look at the rotated key for
     * up to twenty-four hours, and a fleet rotation would leave every domain
     * unverified for a day while the dashboard showed `pending`. Registration
     * makes a new domain immediately due for exactly this reason.
     */
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
    // A tenant moving a customer to a different profile is saying "judge this
    // against something else now", exactly as a rotation does.
    const { id, other, tenantId } = await verified();

    const updated = await updateDomainConfig(db, tenantId, id, {
      profileVersionId: other,
    });

    expect(updated?.profileVersionId).toBe(other);
    expect(updated?.state).toBe("pending");
    expect(updated?.consecutiveFailures).toBe(0);
  });

  it("leaves values alone when only the profile moves", async () => {
    // Stale values are retained rather than pruned: the merge already ignores
    // anything the profile did not ask for, and pruning makes going back lossy.
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
