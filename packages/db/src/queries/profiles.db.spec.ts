import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../client";
import type { ProfileDefinition } from "../schema/profiles";
import { tenants } from "../schema/tenants";
import { truncateAll } from "../test/truncate";
import {
  createProfileVersion,
  currentProfileVersion,
  profileVersionById,
} from "./profiles";

const db = createDb(process.env.DATABASE_URL ?? "", { maxConnections: 5 });

const SENDING: ProfileDefinition = {
  requirements: [
    { check: "spf", include: "_spf.partner.example", key: "spf" },
    { check: "dkim", key: "dkim", selector: "pg1" },
  ],
};

const SENDING_V2: ProfileDefinition = {
  requirements: [...SENDING.requirements, { check: "dmarc", key: "dmarc" }],
};

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function tenant(name = "t"): Promise<string> {
  const [row] = await db.insert(tenants).values({ name }).returning();

  return String(row?.id);
}

describe("createProfileVersion", () => {
  it("starts at version 1", async () => {
    const tenantId = await tenant();

    const created = await createProfileVersion(db, {
      definition: SENDING,
      key: "sending",
      tenantId,
    });

    expect(created.version).toBe(1);
  });

  it("counts up per key rather than per tenant", async () => {
    const tenantId = await tenant();

    await createProfileVersion(db, {
      definition: SENDING,
      key: "sending",
      tenantId,
    });
    const otherKey = await createProfileVersion(db, {
      definition: SENDING,
      key: "receiving",
      tenantId,
    });
    const sameKey = await createProfileVersion(db, {
      definition: SENDING_V2,
      key: "sending",
      tenantId,
    });

    expect(otherKey.version).toBe(1);
    expect(sameKey.version).toBe(2);
  });

  it("starts each tenant's numbering at 1", async () => {
    const first = await tenant("first");
    const second = await tenant("second");

    await createProfileVersion(db, {
      definition: SENDING,
      key: "sending",
      tenantId: first,
    });
    const other = await createProfileVersion(db, {
      definition: SENDING,
      key: "sending",
      tenantId: second,
    });

    expect(other.version).toBe(1);
  });

  it("gives every concurrent create a distinct version", async () => {
    const tenantId = await tenant();

    const created = await Promise.all(
      Array.from({ length: 5 }, () =>
        createProfileVersion(db, {
          definition: SENDING,
          key: "sending",
          tenantId,
        })
      )
    );

    expect(new Set(created.map((row) => row.version)).size).toBe(5);
  });

  it("leaves earlier versions exactly as they were", async () => {
    const tenantId = await tenant();
    const first = await createProfileVersion(db, {
      definition: SENDING,
      key: "sending",
      tenantId,
    });

    await createProfileVersion(db, {
      definition: SENDING_V2,
      key: "sending",
      tenantId,
    });

    const pinned = await profileVersionById(db, tenantId, first.id);

    expect(pinned?.definition).toEqual(SENDING);
    expect(pinned?.version).toBe(1);
  });
});

describe("currentProfileVersion", () => {
  it("returns the newest version, not the newest row", async () => {
    const tenantId = await tenant();

    await createProfileVersion(db, {
      definition: SENDING,
      key: "sending",
      tenantId,
    });
    const second = await createProfileVersion(db, {
      definition: SENDING_V2,
      key: "sending",
      tenantId,
    });

    const current = await currentProfileVersion(db, tenantId, "sending");

    expect(current?.id).toBe(second.id);
    expect(current?.definition).toEqual(SENDING_V2);
  });

  it("does not see another tenant's profile of the same name", async () => {
    const first = await tenant("first");
    const second = await tenant("second");

    await createProfileVersion(db, {
      definition: SENDING,
      key: "sending",
      tenantId: first,
    });

    expect(await currentProfileVersion(db, second, "sending")).toBeUndefined();
  });

  it("is undefined for a key nobody created", async () => {
    const tenantId = await tenant();

    expect(await currentProfileVersion(db, tenantId, "nope")).toBeUndefined();
  });
});

describe("profileVersionById", () => {
  it("does not return another tenant's version by id", async () => {
    const first = await tenant("first");
    const second = await tenant("second");
    const created = await createProfileVersion(db, {
      definition: SENDING,
      key: "sending",
      tenantId: first,
    });

    expect(await profileVersionById(db, second, created.id)).toBeUndefined();
  });
});
