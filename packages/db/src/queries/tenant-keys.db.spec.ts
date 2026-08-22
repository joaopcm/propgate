import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../client";
import { tenantMembers } from "../schema/tenant-members";
import { tenants } from "../schema/tenants";
import { truncateAll } from "../test/truncate";
import { createApiKey } from "./api-keys";
import { activeApiKeyCount } from "./revocation";
import {
  apiKeyForTenant,
  listApiKeysForTenant,
  revokeApiKeyForTenant,
} from "./tenant-keys";

const db = createDb(process.env.DATABASE_URL ?? "", { maxConnections: 4 });

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function tenant(name: string, keys = 1): Promise<string> {
  const [row] = await db.insert(tenants).values({ name }).returning();
  const tenantId = String(row?.id);

  await Promise.all(
    Array.from({ length: keys }, (_, index) =>
      createApiKey(db, { name: `k${index}`, tenantId })
    )
  );

  return tenantId;
}

describe("listApiKeysForTenant", () => {
  it("returns one tenant's keys and nobody else's", async () => {
    const mine = await tenant("mine", 2);

    await tenant("theirs", 3);

    expect(await listApiKeysForTenant(db, mine)).toHaveLength(2);
  });

  it("never carries a hash or a key", async () => {
    const tenantId = await tenant("mine");
    const keys = await listApiKeysForTenant(db, tenantId);

    expect(JSON.stringify(keys)).not.toContain("hashedKey");
  });
});

describe("attribution", () => {
  it("keeps keys with no creator in the list", async () => {
    const tenantId = await tenant("partner", 2);

    const keys = await listApiKeysForTenant(db, tenantId);

    expect(keys).toHaveLength(2);
    expect(keys.every((key) => key.createdByEmail === null)).toBe(true);
  });

  it("names the member who created a key", async () => {
    const tenantId = await tenant("partner");
    const [member] = await db
      .insert(tenantMembers)
      .values({ email: "someone@example.com", tenantId })
      .returning();

    await createApiKey(db, {
      createdByMemberId: String(member?.id),
      name: "attributed",
      tenantId,
    });

    const keys = await listApiKeysForTenant(db, tenantId);
    const attributed = keys.find((key) => key.name === "attributed");

    expect(attributed?.createdByEmail).toBe("someone@example.com");
    expect(attributed?.createdByMemberId).toBe(member?.id);
  });

  it("keeps a member's keys when the member is removed", async () => {
    const tenantId = await tenant("partner");
    const [member] = await db
      .insert(tenantMembers)
      .values({ email: "leaver@example.com", tenantId })
      .returning();

    await createApiKey(db, {
      createdByMemberId: String(member?.id),
      name: "theirs",
      tenantId,
    });

    await db
      .delete(tenantMembers)
      .where(eq(tenantMembers.id, String(member?.id)));

    const keys = await listApiKeysForTenant(db, tenantId);
    const orphaned = keys.find((key) => key.name === "theirs");

    expect(orphaned).toBeDefined();
    expect(orphaned?.createdByMemberId).toBeNull();
    expect(orphaned?.createdByEmail).toBeNull();
  });

  it("reports revokedAt from the update even with the join in place", async () => {
    const tenantId = await tenant("partner", 2);
    const [first] = await listApiKeysForTenant(db, tenantId);

    const outcome = await revokeApiKeyForTenant(db, {
      apiKeyId: String(first?.id),
      tenantId,
    });

    expect(outcome.kind === "revoked" && outcome.key.revokedAt).toBeInstanceOf(
      Date
    );
  });
});

describe("apiKeyForTenant", () => {
  it("does not find another tenant's key by id", async () => {
    const mine = await tenant("mine");
    const theirs = await tenant("theirs");
    const [theirKey] = await listApiKeysForTenant(db, theirs);

    expect(
      await apiKeyForTenant(db, {
        apiKeyId: String(theirKey?.id),
        tenantId: mine,
      })
    ).toBeUndefined();
  });
});

describe("revokeApiKeyForTenant", () => {
  it("revokes and reports the row after the update", async () => {
    const tenantId = await tenant("partner", 2);
    const [first] = await listApiKeysForTenant(db, tenantId);

    const outcome = await revokeApiKeyForTenant(db, {
      apiKeyId: String(first?.id),
      tenantId,
    });

    expect(outcome.kind).toBe("revoked");
    expect(outcome.kind === "revoked" && outcome.key.revokedAt).not.toBeNull();
    expect(await activeApiKeyCount(db, tenantId)).toBe(1);
  });

  it("refuses the last active key", async () => {
    const tenantId = await tenant("partner");
    const [only] = await listApiKeysForTenant(db, tenantId);

    const outcome = await revokeApiKeyForTenant(db, {
      apiKeyId: String(only?.id),
      tenantId,
    });

    expect(outcome.kind).toBe("last-active");
    expect(await activeApiKeyCount(db, tenantId)).toBe(1);
  });

  it("tells an already-revoked key apart from a fresh revoke", async () => {
    const tenantId = await tenant("partner", 3);
    const [first] = await listApiKeysForTenant(db, tenantId);

    await revokeApiKeyForTenant(db, {
      apiKeyId: String(first?.id),
      tenantId,
    });
    const again = await revokeApiKeyForTenant(db, {
      apiKeyId: String(first?.id),
      tenantId,
    });

    expect(again.kind).toBe("already-revoked");
  });

  it("cannot be raced down to zero active keys", async () => {
    const tenantId = await tenant("partner", 2);
    const keys = await listApiKeysForTenant(db, tenantId);

    const outcomes = await Promise.all(
      keys.map((key) =>
        revokeApiKeyForTenant(db, { apiKeyId: key.id, tenantId })
      )
    );

    expect(await activeApiKeyCount(db, tenantId)).toBe(1);
    expect(
      outcomes.filter((outcome) => outcome.kind === "revoked")
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.kind === "last-active")
    ).toHaveLength(1);
  });

  it("does not find an id belonging to another tenant", async () => {
    const mine = await tenant("mine", 2);
    const theirs = await tenant("theirs", 2);
    const [theirKey] = await listApiKeysForTenant(db, theirs);

    const outcome = await revokeApiKeyForTenant(db, {
      apiKeyId: String(theirKey?.id),
      tenantId: mine,
    });

    expect(outcome.kind).toBe("not-found");
    expect(await activeApiKeyCount(db, theirs)).toBe(2);
  });
});
