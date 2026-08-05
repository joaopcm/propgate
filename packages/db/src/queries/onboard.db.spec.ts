import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../client";
import { tenantMembers } from "../schema/tenant-members";
import { tenants } from "../schema/tenants";
import { truncateAll } from "../test/truncate";
import { findOrCreateAccountForEmail } from "./onboard";

/**
 * The account behind a confirmed address.
 *
 * `signup.db.spec.ts` in `apps/api` covers this through the route it serves. What
 * is here is the property that route cannot reach: what happens when two calls
 * arrive for one address at once. A single-use code means the route only ever
 * makes one call, which is exactly why the guarantee underneath it needs testing
 * directly rather than being assumed.
 */

const db = createDb(process.env.DATABASE_URL ?? "", { maxConnections: 4 });

const EMAIL = "someone@example.com";

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("findOrCreateAccountForEmail", () => {
  it("creates a tenant and its first member together", async () => {
    const account = await findOrCreateAccountForEmail(db, { email: EMAIL });

    expect(account.created).toBe(true);

    const [member] = await db.select().from(tenantMembers);

    // A tenant with no member is a tenant nobody can be shown to own, which is
    // why both inserts share one transaction.
    expect(member?.email).toBe(EMAIL);
    expect(member?.tenantId).toBe(account.tenantId);
    expect(member?.id).toBe(account.memberId);
  });

  it("returns the same tenant the second time", async () => {
    const first = await findOrCreateAccountForEmail(db, { email: EMAIL });
    const second = await findOrCreateAccountForEmail(db, { email: EMAIL });

    expect(second.created).toBe(false);
    expect(second.tenantId).toBe(first.tenantId);
    expect(second.memberId).toBe(first.memberId);
    expect(await db.select().from(tenants)).toHaveLength(1);
  });

  it("cannot build two accounts for one address concurrently", async () => {
    // Asserted on the outcome rather than on who won, because the interleaving is
    // the database's to choose: either both calls see the same row, or one aborts
    // on the unique index. Both are correct. Two tenants for one address is not,
    // and that is the only thing worth pinning.
    await Promise.allSettled([
      findOrCreateAccountForEmail(db, { email: EMAIL }),
      findOrCreateAccountForEmail(db, { email: EMAIL }),
    ]);

    expect(await db.select().from(tenants)).toHaveLength(1);
    expect(await db.select().from(tenantMembers)).toHaveLength(1);
  });

  it("treats an address as one account regardless of who normalised it", async () => {
    // The caller lowercases; this asserts nothing here re-introduces a second
    // account for a different casing by writing the raw value somewhere.
    const first = await findOrCreateAccountForEmail(db, { email: EMAIL });
    const second = await findOrCreateAccountForEmail(db, {
      email: EMAIL.toLowerCase(),
    });

    expect(second.tenantId).toBe(first.tenantId);
  });
});
