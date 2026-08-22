import type { Database } from "@propgate/db";
import { createApiKey, createDb, tenants, truncateAll } from "@propgate/db";
import { createRecordingMailer } from "@propgate/emails";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";

const db: Database = createDb(process.env.DATABASE_URL ?? "", {
  maxConnections: 4,
});

const app = createApp({ db, resolver: { address: "127.0.0.1", port: 53 } });

const A_KEY = /^pg_/;
const SIX_DIGITS = /\b(\d{6})\b/;

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function tenantWithKeys(
  name: string,
  count = 1
): Promise<{ key: string; tenantId: string }> {
  const [tenant] = await db.insert(tenants).values({ name }).returning();
  const tenantId = String(tenant?.id);
  const created = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      createApiKey(db, { name: `k${index}`, tenantId })
    )
  );

  return { key: String(created[0]?.key), tenantId };
}

function request(
  apiKey: string,
  path: string,
  init: { body?: unknown; method?: string } = {}
) {
  return app.request(path, {
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    method: init.method ?? "GET",
  });
}

describe("POST /v1/api-keys", () => {
  it("returns a usable key, once", async () => {
    const { key } = await tenantWithKeys("partner");
    const response = await request(key, "/v1/api-keys", {
      body: { name: "ci" },
      method: "POST",
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: { key: string; name: string; prefix: string };
    };

    expect(body.data.key).toMatch(A_KEY);
    expect(body.data.name).toBe("ci");

    const used = await request(body.data.key, "/v1/api-keys");

    expect(used.status).toBe(200);
  });

  it("reports the stored createdAt, not the moment of the response", async () => {
    const { key } = await tenantWithKeys("partner");
    const created = await request(key, "/v1/api-keys", {
      body: { name: "ci" },
      method: "POST",
    });
    const body = (await created.json()) as {
      data: { createdAt: string; id: string };
    };

    const listed = await request(key, "/v1/api-keys");
    const list = (await listed.json()) as {
      data: { createdAt: string; id: string }[];
    };
    const same = list.data.find((row) => row.id === body.data.id);

    expect(same?.createdAt).toBe(body.data.createdAt);
  });

  it("refuses a nameless key", async () => {
    const { key } = await tenantWithKeys("partner");
    const response = await request(key, "/v1/api-keys", {
      body: {},
      method: "POST",
    });

    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toContain("name");
  });

  it("stops unbounded key creation, naming the limit and the ask", async () => {
    const { key } = await tenantWithKeys("partner", 50);
    const response = await request(key, "/v1/api-keys", {
      body: { name: "one-too-many" },
      method: "POST",
    });

    expect(response.status).toBe(422);

    const message = (await response.json()).error.message as string;

    expect(message).toContain("50");
    expect(message).toContain("revoke one");
  });
});

describe("GET /v1/api-keys", () => {
  it("never returns a secret", async () => {
    const { key } = await tenantWithKeys("partner");
    const response = await request(key, "/v1/api-keys");
    const body = await response.json();

    expect(JSON.stringify(body)).not.toContain(key);
    expect(JSON.stringify(body)).not.toContain("hashedKey");
    expect(JSON.stringify(body)).not.toContain("hashed_key");
  });

  it("lists only this tenant's keys", async () => {
    const mine = await tenantWithKeys("mine", 2);

    await tenantWithKeys("theirs", 3);

    const response = await request(mine.key, "/v1/api-keys");
    const body = (await response.json()) as { data: unknown[] };

    expect(body.data).toHaveLength(2);
  });

  it("keeps revoked keys in the list", async () => {
    const { key } = await tenantWithKeys("partner", 3);
    const listed = await request(key, "/v1/api-keys");
    const before = (await listed.json()) as {
      data: { id: string; prefix: string }[];
    };
    const victim = before.data.find((row) => !key.startsWith(row.prefix));

    await request(key, `/v1/api-keys/${victim?.id}`, { method: "DELETE" });

    const after = (await (await request(key, "/v1/api-keys")).json()) as {
      data: { id: string; revoked: boolean }[];
    };

    expect(after.data).toHaveLength(3);
    expect(after.data.find((row) => row.id === victim?.id)?.revoked).toBe(true);
  });
});

describe("DELETE /v1/api-keys/:id", () => {
  it("revokes, and the key then 401s", async () => {
    const { key } = await tenantWithKeys("partner", 2);
    const created = await request(key, "/v1/api-keys", {
      body: { name: "doomed" },
      method: "POST",
    });
    const body = (await created.json()) as {
      data: { id: string; key: string };
    };

    const revoked = await request(key, `/v1/api-keys/${body.data.id}`, {
      method: "DELETE",
    });

    expect(revoked.status).toBe(200);
    expect((await revoked.json()).data.revokedAt).not.toBeNull();

    const used = await request(body.data.key, "/v1/api-keys");

    expect(used.status).toBe(401);
    expect((await used.json()).error.message).toContain("revoked");
  });

  it("lets a tenant revoke the key it is holding", async () => {
    const { key } = await tenantWithKeys("partner", 2);
    const listed = (await (await request(key, "/v1/api-keys")).json()) as {
      data: { id: string; prefix: string }[];
    };
    const mine = listed.data.find((row) => key.startsWith(row.prefix));

    const response = await request(key, `/v1/api-keys/${mine?.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect((await request(key, "/v1/api-keys")).status).toBe(401);
  });

  it("refuses the last active key, and says why", async () => {
    const { key } = await tenantWithKeys("partner");
    const listed = (await (await request(key, "/v1/api-keys")).json()) as {
      data: { id: string }[];
    };

    const response = await request(key, `/v1/api-keys/${listed.data[0]?.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(409);

    const message = (await response.json()).error.message as string;

    expect(message).toContain("last active");
    expect(message).toContain("Create a replacement first");

    expect((await request(key, "/v1/api-keys")).status).toBe(200);
  });

  it("404s another tenant's key id", async () => {
    const mine = await tenantWithKeys("mine");
    const theirs = await tenantWithKeys("theirs", 2);
    const listed = (await (
      await request(theirs.key, "/v1/api-keys")
    ).json()) as {
      data: { id: string }[];
    };

    const response = await request(
      mine.key,
      `/v1/api-keys/${listed.data[0]?.id}`,
      { method: "DELETE" }
    );

    expect(response.status).toBe(404);

    expect((await request(theirs.key, "/v1/api-keys")).status).toBe(200);
  });

  it("says so when the key was already revoked", async () => {
    const { key } = await tenantWithKeys("partner", 3);
    const listed = (await (await request(key, "/v1/api-keys")).json()) as {
      data: { id: string; prefix: string }[];
    };
    const other = listed.data.find((row) => !key.startsWith(row.prefix));

    await request(key, `/v1/api-keys/${other?.id}`, { method: "DELETE" });
    const again = await request(key, `/v1/api-keys/${other?.id}`, {
      method: "DELETE",
    });

    expect(again.status).toBe(200);
    expect((await again.json()).meta.alreadyRevoked).toBe(true);
  });
});

describe("attribution", () => {
  it("has no creator for an operator-minted key", async () => {
    const { key } = await tenantWithKeys("partner");
    const listed = await request(key, "/v1/api-keys");
    const body = (await listed.json()) as {
      data: { createdBy: string | null }[];
    };

    expect(body.data[0]?.createdBy).toBeNull();
  });

  it("attributes a key created through the API to the presenting key's creator", async () => {
    const mailer = createRecordingMailer();
    const app2 = createApp({
      db,
      mailer,
      resolver: { address: "127.0.0.1", port: 53 },
    });

    await app2.request("/v1/signup", {
      body: JSON.stringify({ email: "owner@example.com" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    const code = SIX_DIGITS.exec(mailer.sent.at(-1)?.text ?? "")?.[1];
    const confirmed = await app2.request("/v1/signup/confirm", {
      body: JSON.stringify({ code, email: "owner@example.com" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const onboarding = (await confirmed.json()) as { data: { apiKey: string } };

    const created = await request(onboarding.data.apiKey, "/v1/api-keys", {
      body: { name: "ci" },
      method: "POST",
    });
    const body = (await created.json()) as {
      data: { createdBy: string | null };
    };

    expect(body.data.createdBy).toBe("owner@example.com");
  });
});

describe("authentication", () => {
  it("401s without a key", async () => {
    const statuses = await Promise.all(
      ["/v1/api-keys", "/v1/api-keys/anything"].map(async (path) => {
        const response = await app.request(path);

        return response.status;
      })
    );

    expect(statuses).toEqual([401, 401]);
  });
});
