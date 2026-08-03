import type { Database } from "@propgate/db";
import { createApiKey, createDb, tenants, truncateAll } from "@propgate/db";
import { fixtureTarget } from "@propgate/dns-fixtures";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";

/**
 * `POST /v1/domains/:id/checks` against the real DNS tier and a real database.
 *
 * The only specs in the repo that need both, which is why they have a project
 * of their own. What a check does to a domain — its state, its stored result,
 * its timeline — is the half of this milestone that cannot be asserted without
 * DNS, and the half where getting it wrong is a webhook to somebody's customer
 * in milestone 2.
 */

const db: Database = createDb(process.env.DATABASE_URL ?? "", {
  maxConnections: 4,
});

const fixture = fixtureTarget("resolver");
const app = createApp({
  db,
  resolver: { address: fixture.address, port: fixture.port },
});

/** A resolver with nothing behind it, for the indeterminate path. */
const deadApp = createApp({ db, resolver: { address: "127.0.0.1", port: 1 } });

const ADDRESS_AND_PORT = /^\d+\.\d+\.\d+\.\d+:\d+$/;

const SENDING = {
  key: "sending",
  requirements: [
    { check: "spf", include: "one.spf.test", key: "spf" },
    { check: "dkim", key: "dkim", selector: "pg1" },
    { check: "dmarc", key: "dmarc" },
  ],
};

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

function request(
  key: string,
  path: string,
  init: { app?: typeof app; body?: unknown; method?: string } = {}
) {
  return (init.app ?? app).request(path, {
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    method: init.method ?? "GET",
  });
}

async function partner(
  name: string,
  profile: unknown = SENDING
): Promise<{ domainId: string; key: string }> {
  const [tenant] = await db.insert(tenants).values({ name }).returning();
  const created = await createApiKey(db, {
    name: "k",
    tenantId: String(tenant?.id),
  });

  await request(created.key, "/v1/profiles", {
    body: profile,
    method: "POST",
  });

  const registered = await (
    await request(created.key, "/v1/domains", {
      body: { name: "customer.test", profile: "sending" },
      method: "POST",
    })
  ).json();

  return { domainId: registered.data.id, key: created.key };
}

function check(key: string, domainId: string, useApp = app) {
  return request(key, `/v1/domains/${domainId}/checks`, {
    app: useApp,
    method: "POST",
  });
}

describe("verifying a correctly configured domain", () => {
  it("moves it from pending to verified", async () => {
    const { domainId, key } = await partner("partner");

    const body = await (await check(key, domainId)).json();

    expect(body.data.state).toBe("verified");
    expect(body.data.requirementsMet).toBe(3);
    expect(body.data.requirementsTotal).toBe(3);
  });

  it("stores the result in place, so a read needs no second check", async () => {
    const { domainId, key } = await partner("partner");

    await check(key, domainId);
    const reread = await (await request(key, `/v1/domains/${domainId}`)).json();

    expect(reread.data.state).toBe("verified");
    expect(reread.data.lastCheckedAt).not.toBeNull();
    expect(reread.data.requirements).toHaveLength(3);
  });

  it("names the requirement that is unmet, and only that one", async () => {
    // The product's promise: "3 of 4 requirements met", with the missing one
    // identified and no instructions rendered.
    const { domainId, key } = await partner("partner", {
      key: "sending",
      requirements: [
        { check: "spf", include: "one.spf.test", key: "spf" },
        { check: "dkim", key: "issued", selector: "pg1" },
        { check: "dkim", key: "rotated", selector: "pg2" },
      ],
    });

    const body = await (await check(key, domainId)).json();
    const unmet = body.data.requirements.filter(
      (entry: { satisfied: boolean }) => !entry.satisfied
    );

    // `degraded`, not `failed`. One failing check is one failing check —
    // hysteresis is what stands between a resolver blip and a webhook that pages
    // a customer's customer. This asserted `failed` until that landed.
    expect(body.data.state).toBe("degraded");
    expect(body.data.requirementsMet).toBe(2);
    expect(unmet.map((entry: { key: string }) => entry.key)).toEqual([
      "rotated",
    ]);
    expect(unmet[0].findings.length).toBeGreaterThan(0);
  });

  it("reaches failed only after the threshold, through the real route", async () => {
    // The pure function is table-tested in `hysteresis.spec.ts`. This is the
    // end-to-end version: the counter has to survive a round trip through
    // Postgres, or the domain would sit at `degraded` forever and nothing would
    // ever be reported.
    const { domainId, key } = await partner("partner", {
      key: "sending",
      requirements: [{ check: "dkim", key: "rotated", selector: "pg2" }],
    });

    const first = await (await check(key, domainId)).json();
    const second = await (await check(key, domainId)).json();
    const third = await (await check(key, domainId)).json();

    expect([first.data.state, second.data.state, third.data.state]).toEqual([
      "degraded",
      "degraded",
      "failed",
    ]);
  });
});

describe("an indeterminate check", () => {
  it("leaves the state exactly where it was", async () => {
    // The edge that is not an edge. A verified domain whose check could not
    // complete stays verified — in milestone 2 the alternative is paging a
    // partner's customer because our upstream had a bad second.
    const { domainId, key } = await partner("partner");

    await check(key, domainId);
    const blind = await (await check(key, domainId, deadApp)).json();

    expect(blind.data.verdict).toBe("indeterminate");
    expect(blind.data.state).toBe("verified");
  });

  it("still records that we looked", async () => {
    const { domainId, key } = await partner("partner");

    const blind = await (await check(key, domainId, deadApp)).json();

    expect(blind.data.state).toBe("pending");
    expect(blind.data.lastCheckedAt).not.toBeNull();
  });

  it("appends nothing to the timeline", async () => {
    // A timeline entry saying a record changed to uncertainty is worse than a
    // gap: the gap is honest, the entry is a claim nobody observed.
    const { domainId, key } = await partner("partner");

    await check(key, domainId, deadApp);
    const timeline = await (
      await request(key, `/v1/domains/${domainId}/timeline`)
    ).json();

    expect(timeline.data).toEqual([]);
  });
});

describe("the timeline", () => {
  it("records the first sighting of every requirement", async () => {
    const { domainId, key } = await partner("partner");

    await check(key, domainId);
    const timeline = await (
      await request(key, `/v1/domains/${domainId}/timeline`)
    ).json();

    expect(timeline.data).toHaveLength(3);
    expect(
      timeline.data.every((e: { previous: null }) => e.previous === null)
    ).toBe(true);
  });

  it("writes nothing when a re-check sees the same thing", async () => {
    // The assertion the infrastructure bill depends on. A sweep observing the
    // same values six times a day must write nothing at all.
    const { domainId, key } = await partner("partner");

    await check(key, domainId);
    await check(key, domainId);
    await check(key, domainId);

    const timeline = await (
      await request(key, `/v1/domains/${domainId}/timeline`)
    ).json();

    expect(timeline.data).toHaveLength(3);
  });
});

describe("the derivation behind a verdict", () => {
  it("returns every lookup the check made", async () => {
    // "Why did you say that" is the question a disputed verdict produces. The
    // free public checker has always answered it; before this the paid path
    // could not, which is exactly backwards.
    const { domainId, key } = await partner("partner");

    const body = await (await check(key, domainId)).json();

    expect(body.data.lookups.length).toBeGreaterThan(0);
    expect(body.data.lookups[0]).toMatchObject({
      name: expect.any(String),
      purpose: expect.any(String),
      server: expect.any(String),
      status: expect.any(String),
    });
  });

  it("keeps it, so a dispute a week later can still be answered", async () => {
    const { domainId, key } = await partner("partner");

    await check(key, domainId);
    const reread = await (await request(key, `/v1/domains/${domainId}`)).json();

    expect(reread.data.lookups.length).toBeGreaterThan(0);
  });

  it("names the server that was asked", async () => {
    // A lame delegation is a fact about one nameserver, not about the zone.
    const { domainId, key } = await partner("partner");

    const body = await (await check(key, domainId)).json();

    expect(body.data.lookups[0].server).toMatch(ADDRESS_AND_PORT);
  });
});
