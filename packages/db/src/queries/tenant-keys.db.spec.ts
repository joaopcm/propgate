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

/**
 * The tenant-scoped key queries.
 *
 * `api-keys.db.spec.ts` in `apps/api` covers the route. What lives here is the
 * concurrency property the route cannot reach: revoking two keys at once needs
 * both calls to arrive without either being the key that authenticated them, and
 * over HTTP one of them always is.
 */

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

    // The distinction this file exists for: `listApiKeys` in revocation.ts would
    // return all five, which is right for an operator and a cross-tenant leak
    // behind a bearer token.
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

    // Every key that predates `created_by_member_id`, and every operator-minted
    // one, has a null creator. An inner join would drop exactly those — a list
    // that silently omits the oldest keys, which are the ones an audit is most
    // likely to be looking for.
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

    // `set null`, not `cascade`. A live integration is authenticating with that
    // key, and deleting it would take production down as a side effect of tidying
    // up a departure. The attribution is lost; the credential is not.
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

    // `RETURNING` cannot see a joined table, so the update returns only the field
    // it changed and it is merged into the joined row. If that merge is dropped,
    // this goes back to reporting the null the database no longer holds.
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

    // Filtering on the id and checking the tenant afterwards is the same bug
    // written later, and it is the one that reads as harmless in review.
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

    // There is no un-revoke, and the API that would mint a replacement is the one
    // this key opens.
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

    /**
     * Both keys, at once.
     *
     * This is the whole reason `revokeApiKeyForTenant` takes `FOR UPDATE` on the
     * tenant's active rows before counting them. Without the lock each call reads
     * two active keys under its own snapshot, each updates a *different* row so no
     * row lock ever conflicts, and the tenant ends with zero keys and no way back
     * — the exact outcome the last-active guard exists to prevent, arrived at by
     * two calls that each individually respected it.
     */
    const outcomes = await Promise.all(
      keys.map((key) =>
        revokeApiKeyForTenant(db, { apiKeyId: key.id, tenantId })
      )
    );

    expect(await activeApiKeyCount(db, tenantId)).toBe(1);
    // One went through, one was refused for being the last.
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
