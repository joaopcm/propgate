import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../client";
import { tenantMembers } from "../schema/tenant-members";
import { tenants } from "../schema/tenants";
import { truncateAll } from "../test/truncate";
import { findOrCreateAccountForEmail } from "./onboard";

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
    await Promise.allSettled([
      findOrCreateAccountForEmail(db, { email: EMAIL }),
      findOrCreateAccountForEmail(db, { email: EMAIL }),
    ]);

    expect(await db.select().from(tenants)).toHaveLength(1);
    expect(await db.select().from(tenantMembers)).toHaveLength(1);
  });

  it("treats an address as one account regardless of who normalised it", async () => {
    const first = await findOrCreateAccountForEmail(db, { email: EMAIL });
    const second = await findOrCreateAccountForEmail(db, {
      email: EMAIL.toLowerCase(),
    });

    expect(second.tenantId).toBe(first.tenantId);
  });
});
