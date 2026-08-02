import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../client";
import { apiKeys } from "../schema/api-keys";
import { tenants } from "../schema/tenants";
import { truncateAll } from "../test/truncate";
import { authenticateApiKey, createApiKey } from "./api-keys";
import {
  activeApiKeyCount,
  listApiKeys,
  revokeApiKeyByReference,
} from "./revocation";

const db = createDb(process.env.DATABASE_URL ?? "", { maxConnections: 2 });

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function tenant(name: string): Promise<string> {
  const [row] = await db.insert(tenants).values({ name }).returning();

  return String(row?.id);
}

describe("listApiKeys", () => {
  it("shows the prefix, which is the only part an operator still has", async () => {
    const tenantId = await tenant("Partner");
    const created = await createApiKey(db, { name: "production", tenantId });

    const [listed] = await listApiKeys(db);

    expect(listed?.prefix).toBe(created.prefix);
    expect(listed?.tenantName).toBe("Partner");
    expect(listed?.revokedAt).toBeNull();
  });

  it("never contains anything that could be presented as a key", async () => {
    const tenantId = await tenant("Partner");
    const created = await createApiKey(db, { name: "production", tenantId });

    const listed = await listApiKeys(db);

    expect(JSON.stringify(listed)).not.toContain(created.key);
    expect(JSON.stringify(listed)).not.toContain(created.hashedKey);
  });
});

describe("revokeApiKeyByReference", () => {
  it("revokes by prefix, which is what a human has to hand", async () => {
    const tenantId = await tenant("Partner");
    const keep = await createApiKey(db, { name: "other", tenantId });
    const doomed = await createApiKey(db, { name: "leaked", tenantId });

    const outcome = await revokeApiKeyByReference(db, doomed.prefix);

    expect(outcome.kind).toBe("revoked");
    expect(await authenticateApiKey(db, doomed.key)).toEqual({
      ok: false,
      reason: "revoked",
    });
    // And the other one still works.
    expect((await authenticateApiKey(db, keep.key)).ok).toBe(true);
  });

  it("revokes by id too", async () => {
    const tenantId = await tenant("Partner");
    await createApiKey(db, { name: "other", tenantId });
    const doomed = await createApiKey(db, { name: "leaked", tenantId });

    expect((await revokeApiKeyByReference(db, doomed.id)).kind).toBe("revoked");
  });

  it("takes effect on the very next request", async () => {
    // No cache to wait out: bearerAuth reads revoked_at on every lookup, which
    // is the property that makes revocation worth having at all.
    const tenantId = await tenant("Partner");
    await createApiKey(db, { name: "other", tenantId });
    const doomed = await createApiKey(db, { name: "leaked", tenantId });

    expect((await authenticateApiKey(db, doomed.key)).ok).toBe(true);
    await revokeApiKeyByReference(db, doomed.prefix);
    expect((await authenticateApiKey(db, doomed.key)).ok).toBe(false);
  });

  it("refuses a reference nobody issued", async () => {
    expect(await revokeApiKeyByReference(db, "pg_live_nope")).toEqual({
      kind: "not-found",
    });
  });

  it("refuses to guess when a prefix matches more than one key", async () => {
    // Four base64url characters with no unique index. A collision is unlikely
    // and not impossible, and revoking the wrong partner's access is not a
    // thing to decide on a coin flip.
    const first = await tenant("First");
    const second = await tenant("Second");
    const a = await createApiKey(db, { name: "a", tenantId: first });
    await createApiKey(db, { name: "b", tenantId: first });
    await createApiKey(db, { name: "c", tenantId: second });

    // Force the collision rather than hope for one.
    await db
      .update(apiKeys)
      .set({ prefix: a.prefix })
      .where(eq(apiKeys.name, "c"));

    const outcome = await revokeApiKeyByReference(db, a.prefix);

    expect(outcome.kind).toBe("ambiguous");
    expect(outcome.kind === "ambiguous" && outcome.matches).toHaveLength(2);
    // Nothing was revoked.
    expect((await authenticateApiKey(db, a.key)).ok).toBe(true);
  });

  it("says a key was already revoked rather than implying it just did it", async () => {
    const tenantId = await tenant("Partner");
    await createApiKey(db, { name: "other", tenantId });
    const doomed = await createApiKey(db, { name: "leaked", tenantId });

    await revokeApiKeyByReference(db, doomed.prefix);
    const again = await revokeApiKeyByReference(db, doomed.prefix);

    expect(again.kind).toBe("already-revoked");
  });

  it("will not lock a tenant out by accident", async () => {
    // The mistake that is easy to make under pressure and annoying to undo:
    // there is no un-revoke, only minting a new key and getting it to them.
    const tenantId = await tenant("Partner");
    const only = await createApiKey(db, { name: "production", tenantId });

    const outcome = await revokeApiKeyByReference(db, only.prefix);

    expect(outcome.kind).toBe("last-active");
    expect((await authenticateApiKey(db, only.key)).ok).toBe(true);
  });

  it("will lock a tenant out on purpose", async () => {
    const tenantId = await tenant("Partner");
    const only = await createApiKey(db, { name: "production", tenantId });

    const outcome = await revokeApiKeyByReference(db, only.prefix, {
      force: true,
    });

    expect(outcome.kind).toBe("revoked");
    expect((await authenticateApiKey(db, only.key)).ok).toBe(false);
  });

  it("counts a tenant's own active keys, not everybody's", async () => {
    const first = await tenant("First");
    const second = await tenant("Second");
    await createApiKey(db, { name: "a", tenantId: first });
    await createApiKey(db, { name: "b", tenantId: second });
    const only = await createApiKey(db, { name: "c", tenantId: second });

    // Two keys exist overall, but only two belong to Second and one to First.
    expect(await activeApiKeyCount(db, first)).toBe(1);
    expect(await activeApiKeyCount(db, second)).toBe(2);
    expect((await revokeApiKeyByReference(db, only.prefix)).kind).toBe(
      "revoked"
    );
  });
});
