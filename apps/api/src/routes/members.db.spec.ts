import type { Database } from "@propgate/db";
import {
  createApiKey,
  createDb,
  tenantMembers,
  tenants,
  truncateAll,
} from "@propgate/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";

/**
 * `GET /v1/members`.
 *
 * The tenancy assertion is the one that matters: `tenant_members.email` is
 * globally unique, so the table is the closest thing in this schema to a list of
 * every customer. A query that forgot its `tenantId` would hand one account the
 * addresses of all of them.
 */

const db: Database = createDb(process.env.DATABASE_URL ?? "", {
  maxConnections: 4,
});

const app = createApp({ db, resolver: { address: "127.0.0.1", port: 53 } });

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function account(
  name: string,
  emails: readonly string[]
): Promise<string> {
  const [tenant] = await db.insert(tenants).values({ name }).returning();
  const tenantId = String(tenant?.id);

  if (emails.length > 0) {
    // One statement rather than a loop: every row then shares a `created_at`, so
    // the order the endpoint reports is decided by the uuidv7 tiebreaker, which
    // follows the order given here. A loop would leave it to clock resolution.
    await db
      .insert(tenantMembers)
      .values(emails.map((email) => ({ email, tenantId })));
  }

  const created = await createApiKey(db, { name: "k", tenantId });

  return created.key;
}

function get(apiKey: string) {
  return app.request("/v1/members", {
    headers: { authorization: `Bearer ${apiKey}` },
  });
}

describe("GET /v1/members", () => {
  it("lists this account's members", async () => {
    const key = await account("mine", [
      "first@example.com",
      "second@example.com",
    ]);
    const response = await get(key);

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: { email: string; object: string }[];
    };

    expect(body.data.map((member) => member.email)).toEqual([
      "first@example.com",
      "second@example.com",
    ]);
    expect(body.data[0]?.object).toBe("member");
  });

  it("never shows another account's members", async () => {
    const mine = await account("mine", ["mine@example.com"]);

    await account("theirs", ["theirs@example.com", "other@example.com"]);

    const body = (await (await get(mine)).json()) as {
      data: { email: string }[];
    };

    // `tenant_members.email` is globally unique, so this table is the nearest
    // thing to a customer list. A missing tenant filter here is a leak of every
    // address in the system, not just an untidy response.
    expect(body.data).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("theirs@example.com");
  });

  it("is empty rather than absent for an operator-minted account", async () => {
    // `mint.js` creates a tenant with no member at all. An empty list is the
    // honest answer; a 404 would suggest the account does not exist.
    const key = await account("operator", []);
    const response = await get(key);

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([]);
  });

  it("401s without a key", async () => {
    // The family is in the auth middleware list in app.ts. Mounted without an
    // entry there it would be publicly reachable and read a tenant-scoped table
    // with an undefined tenant.
    expect((await app.request("/v1/members")).status).toBe(401);
  });
});
