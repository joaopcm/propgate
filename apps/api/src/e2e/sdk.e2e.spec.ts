import { serve } from "@hono/node-server";
import type { Database } from "@propgate/db";
import { createDb, mintTenantKey, truncateAll } from "@propgate/db";
import { fixtureTarget } from "@propgate/dns-fixtures";
import type { PropgateResult } from "@propgate/sdk";
import { Propgate } from "@propgate/sdk";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";

/**
 * `@propgate/sdk` against a real API, over a socket.
 *
 * The seam nothing else covers. Every spec inside the SDK package answers its
 * own questions: the server on the other end is a body written by whoever wrote
 * the client, so renaming `nextCursor` on the wire leaves them green while
 * `listAll` silently walks one page and stops. This is the same argument, and
 * the same file layout, as `cli.e2e.spec.ts` — see the long note there.
 *
 * So nothing here is a stand-in. The client is the published `Propgate` class,
 * the server is `createApp()`, the DNS is the fixture tier, the database is
 * Postgres. What is deliberately *not* asserted is anything a cheaper spec
 * already pins: hysteresis, delivery signing and the state machine belong to
 * `cli.e2e` and the integration specs. This one covers the join between the two
 * beliefs about the wire, and nothing else.
 *
 * There is no signup here because the SDK has none. A key is minted directly,
 * which is what a customer holding one already has.
 */

const db: Database = createDb(process.env.DATABASE_URL ?? "", {
  maxConnections: 4,
});

/** The key both fixture zones publish, so one expectation serves both domains. */
const DKIM_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApbBuIv1NwQ/rmgGPN8OufvLBfd2asvyk4ajVkiW2CsC12MohickhGufJPsGNyO/ZXD4b/HnClukz07BZwpJe80wz0w/AfhJCqM8F3v/aVHF7wWnd9wBBPBroTL7kNx5u39NnBZZj8SYJF7zNaQ3rud4ekF+GAyTovT7MUfXHQBgEZn0n5Y4dN7b7VEMi4/97TDCNDJucFywdDmbJ9r6LaCu+l+gWfZGl4rDimTJCw3oCQIpCOGlNrWPwxRLuB0sLR2gR1GT9EqBg3yGforXasq2wqBuZlpI1YXmdldEZh3VRIyft4TeVTHRJAf7/TKuAINb8+LOoXHj5hFYl+C4zUQIDAQAB";

/**
 * Loopback is the whole point, so the production policy has to be replaced.
 *
 * Written here rather than exported from the route, for the reason given in
 * `cli.e2e.spec.ts`: the only artefact in this repository that permits a webhook
 * to a private address should be a spec file.
 */
function allowLoopbackWebhookUrl(raw: string): string | null {
  return raw.startsWith("https://hooks.")
    ? null
    : `${raw} is not the receiver this spec pretends to have`;
}

interface Harness {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
  readonly key: string;
}

let harness: Harness;
let propgate: Propgate;

async function start(): Promise<Harness> {
  const fixture = fixtureTarget("auth");
  const resolver = { address: fixture.address, port: fixture.port };
  const app = createApp({
    db,
    resolver,
    resolvers: [resolver],
    webhookUrlPolicy: allowLoopbackWebhookUrl,
  });
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });

  await new Promise((resolve) => {
    server.once("listening", resolve);
  });

  const minted = await mintTenantKey(db, {
    keyName: "sdk-e2e",
    tenantName: "sdk-e2e",
  });

  return {
    baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
    key: minted.key,
  };
}

/**
 * The data, or a throw naming why there is none.
 *
 * For the values a test needs in order to keep going — an id it is about to
 * check. A precondition that fails is an error rather than a verdict about the
 * thing under test, and the obvious alternative, `result.data?.id ?? ""`, sends
 * an empty id into the next request and fails there instead.
 */
function must<T, M>(result: PropgateResult<T, M>): T {
  if (result.error !== null) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }

  return result.data;
}

async function profile(key: string, requirements: unknown[]): Promise<void> {
  const created = await propgate.profiles.create({
    key,
    requirements: requirements as never,
  });

  if (created.error !== null) {
    throw new Error(`profiles.create failed: ${created.error.message}`);
  }
}

beforeEach(async () => {
  await truncateAll(db);

  harness = await start();
  propgate = new Propgate(harness.key, { baseUrl: harness.baseUrl });
});

afterEach(async () => {
  await harness.close();
});

afterAll(async () => {
  await db.$client.end();
});

describe("a partner driving the whole lifecycle from Node", () => {
  it("goes from no domain to a verified one, and reads back what it stored", async () => {
    await profile("sending", [
      {
        check: "dkim",
        key: "dkim",
        requiredPerDomain: ["expectedPublicKey"],
        selector: "pg1",
      },
      { check: "dmarc", key: "dmarc" },
    ]);

    /**
     * The refusal before the success, because it is the more valuable of the
     * two: a profile that requires a per-domain value and a registration that
     * omits it has to fail at write time, with a message naming the field.
     */
    const refused = await propgate.domains.create({
      name: "customer.test",
      profile: "sending",
    });

    expect(refused.data).toBeNull();
    expect(refused.error?.code).toBe("invalid_request");
    expect(refused.error?.statusCode).toBe(422);
    expect(refused.error?.message).toContain(
      "expectations.dkim.expectedPublicKey"
    );

    const added = await propgate.domains.create({
      expectations: { dkim: { expectedPublicKey: DKIM_KEY } },
      externalId: "cust_1",
      name: "customer.test",
      profile: "sending",
    });

    expect(added.error).toBeNull();
    // Registration does not touch DNS. The day this arrives `verified`, a bulk
    // import has become a DNS storm.
    expect(added.data?.state).toBe("pending");
    expect(added.meta?.created).toBe(true);

    const { id } = must(added);
    const checked = await propgate.domains.check(id);

    expect(checked.error).toBeNull();
    expect(checked.data?.state).toBe("verified");
    expect(checked.data?.requirementsMet).toBe(checked.data?.requirementsTotal);
    // The derivation, which only the detail routes carry. A verdict that cannot
    // be explained is a verdict nobody can dispute.
    expect(checked.data?.lookups?.length).toBeGreaterThan(0);
    expect(checked.meta?.resolver).toContain(":");

    const read = await propgate.domains.get(id);

    expect(read.data?.verdict).toBe("pass");
    expect(read.data?.expectations).toEqual({
      dkim: { expectedPublicKey: DKIM_KEY },
    });
    expect(read.data?.expectationsFingerprint).toEqual(expect.any(String));

    const timeline = await propgate.domains.timeline(id);

    expect(timeline.data?.length).toBeGreaterThan(0);
    expect(timeline.data?.[0]).toMatchObject({ object: "record_change" });

    const removed = await propgate.domains.remove(id);

    expect(removed.data).toEqual({ deleted: true, id });
    expect((await propgate.domains.get(id)).error?.code).toBe("not_found");
  });

  it("re-points a domain at new expectations rather than re-registering it", async () => {
    await profile("arc", [
      {
        check: "dkim",
        key: "dkim",
        requiredPerDomain: ["expectedPublicKey"],
        selector: "pg1",
      },
    ]);

    const added = await propgate.domains.create({
      expectations: { dkim: { expectedPublicKey: DKIM_KEY } },
      externalId: "cust_1",
      name: "split.test",
      profile: "arc",
    });
    const { id } = must(added);

    expect((await propgate.domains.check(id)).data?.state).toBe("verified");

    // Re-sending `create` with the same external id is the idempotent path, and
    // it deliberately writes nothing — which is why a rotation is `update`.
    const again = await propgate.domains.create({
      expectations: { dkim: { expectedPublicKey: "rotated" } },
      externalId: "cust_1",
      name: "split.test",
      profile: "arc",
    });

    expect(again.meta?.created).toBe(false);
    expect(again.data?.expectations).toEqual({
      dkim: { expectedPublicKey: DKIM_KEY },
    });

    const rotated = await propgate.domains.update(id, {
      expectations: {
        dkim: { expectedPublicKey: `${DKIM_KEY.slice(0, -4)}AAAA` },
      },
    });

    // Back to `pending`: nothing has judged the new key yet, and claiming the
    // old verdict still holds would be the SDK reporting a state for a
    // configuration nothing has checked.
    expect(rotated.data?.state).toBe("pending");
    expect(rotated.meta?.profileVersionId).toEqual(expect.any(String));
    expect((await propgate.domains.check(id)).data?.state).toBe("pending");
  });

  it("walks every page of a list the server pages", async () => {
    /**
     * The failure this file exists for. `listAll` follows `meta.nextCursor`, and
     * the SDK's own specs answer that question with a body they wrote
     * themselves — so renaming the field on the server is invisible to them
     * while it silently truncates a customer's reconciliation run.
     */
    await profile("sending", [{ check: "dkim", key: "dkim", selector: "pg1" }]);

    for (const name of ["customer.test", "healthy.test", "split.test"]) {
      // biome-ignore lint/performance/noAwaitInLoops: registration order is the paging order
      await propgate.domains.create({ name, profile: "sending" });
    }

    const page = await propgate.domains.list({ limit: 1 });

    expect(page.data).toHaveLength(1);
    expect(page.meta?.nextCursor).toEqual(expect.any(String));

    const all = await propgate.domains.listAll();

    expect(all.data).toHaveLength(3);
    expect(all.error).toBeNull();

    const filtered = await propgate.domains.listAll({ state: "verified" });

    expect(filtered.data).toHaveLength(0);
  });

  it("records what a state change owes, and lists it under the endpoint", async () => {
    /**
     * No queue and no receiver: with neither, a transition still writes the
     * delivery row and leaves it `pending` for the reconciler. That is the
     * property being relied on rather than a testing convenience — the row is
     * the obligation, and Redis is only how an attempt gets scheduled promptly.
     */
    const endpoint = await propgate.webhooks.create({
      events: ["domain.verified"],
      url: "https://hooks.example.test/propgate",
    });

    expect(endpoint.meta?.created).toBe(true);
    // Readable exactly once, and only on the call that created it.
    expect(endpoint.data?.secret).toEqual(expect.any(String));

    const { id: webhookId } = must(endpoint);
    const repeated = await propgate.webhooks.create({
      url: "https://hooks.example.test/propgate",
    });

    expect(repeated.meta?.created).toBe(false);
    expect(repeated.data?.secret).toBeUndefined();

    await profile("sending", [{ check: "dkim", key: "dkim", selector: "pg1" }]);

    const added = await propgate.domains.create({
      name: "customer.test",
      profile: "sending",
    });

    await propgate.domains.check(must(added).id);

    const deliveries = await propgate.webhooks.listAllDeliveries(webhookId);

    expect(deliveries.data).toHaveLength(1);
    expect(deliveries.data?.[0]).toMatchObject({
      event: "domain.verified",
      status: "pending",
    });
    expect(deliveries.data?.[0]?.payload.data).toMatchObject({
      domain: "customer.test",
      previous_state: "pending",
      state: "verified",
    });

    const rotated = await propgate.webhooks.rotateSecret(webhookId, {
      windowHours: 0,
    });

    expect(rotated.data?.secret).not.toBe(endpoint.data?.secret);
    expect(rotated.meta?.previousSecretExpiresAt).toEqual(expect.any(String));

    const disabled = await propgate.webhooks.update(webhookId, {
      disabled: true,
    });

    expect(disabled.data?.disabled).toBe(true);
    expect((await propgate.webhooks.list()).data).toHaveLength(1);
    expect((await propgate.webhooks.get(webhookId)).data?.disabled).toBe(true);
    expect((await propgate.webhooks.remove(webhookId)).data?.deleted).toBe(
      true
    );
  });

  it("manages the credentials it authenticates with", async () => {
    const created = await propgate.apiKeys.create({ name: "second" });

    expect(created.error).toBeNull();
    // The only time the secret is ever readable, on this route or any other.
    expect(created.data?.key).toEqual(expect.any(String));
    expect(created.data?.prefix).toEqual(expect.any(String));

    const keys = await propgate.apiKeys.list();

    expect(keys.data).toHaveLength(2);
    expect(keys.data?.map((key) => key.name)).toContain("second");

    // The new key authenticates, which is the half of "create" that a response
    // body cannot demonstrate. Another tenant's id — and any id that does not
    // exist — is a 404 rather than a 403, so a wrong answer cannot confirm that
    // an id exists somewhere.
    const second = new Propgate(must(created).key, {
      baseUrl: harness.baseUrl,
    });

    expect((await second.apiKeys.revoke("nope")).error?.code).toBe("not_found");

    const revoked = await propgate.apiKeys.revoke(must(created).id);

    expect(revoked.data?.revoked).toBe(true);
    expect(revoked.meta?.alreadyRevoked).toBe(false);
    // Not a failure: the key is revoked either way, but a script re-running its
    // own cleanup deserves to know it was not the one that did it.
    expect(
      (await propgate.apiKeys.revoke(must(created).id)).meta?.alreadyRevoked
    ).toBe(true);
    expect((await second.apiKeys.list()).error?.code).toBe("unauthorized");
  });

  it("reads the profile version a domain was registered against", async () => {
    await profile("sending", [{ check: "dmarc", key: "dmarc" }]);

    const first = await propgate.profiles.get("sending");

    expect(first.data?.version).toBe(1);
    expect(first.data?.requirements).toEqual([
      { check: "dmarc", key: "dmarc" },
    ]);

    // Writing an existing key is a new version rather than an edit, because
    // domains pin the version they were registered against.
    await profile("sending", [
      { check: "dmarc", key: "dmarc" },
      { check: "mx", expectsMail: true, key: "mx" },
    ]);

    const second = await propgate.profiles.get("sending");

    expect(second.data?.version).toBe(2);
    expect(second.data?.id).not.toBe(first.data?.id);
    expect((await propgate.profiles.get("absent")).error?.code).toBe(
      "not_found"
    );
  });

  it("answers the calls that need no key, and refuses the ones that do", async () => {
    const anonymous = new Propgate(undefined, { baseUrl: harness.baseUrl });

    expect((await anonymous.health()).data?.status).toBe("ok");

    // One check kind rather than the default of all of them: `customer.test`
    // publishes DKIM, and asking it about CAA or MX would be asserting things
    // about the fixture zone that this file has no reason to pin.
    const check = await anonymous.checks.run({
      checks: ["dkim"],
      dkimSelectors: ["pg1"],
      domain: "customer.test",
    });

    expect(check.error).toBeNull();
    expect(check.data?.verdict).toBe("pass");
    expect(check.data?.object).toBe("check");
    // The taxonomy travels with the finding, so a consumer renders something a
    // human reads without shipping a copy of the registry.
    for (const finding of check.data?.findings ?? []) {
      expect(finding.slug).toEqual(expect.any(String));
      expect(finding.summary).toEqual(expect.any(String));
    }

    // No round trip: the client knows this one cannot work.
    const refused = await anonymous.members.list();

    expect(refused.error?.code).toBe("missing_api_key");

    const wrong = new Propgate("pg_live_not_a_key", {
      baseUrl: harness.baseUrl,
    });

    expect((await wrong.members.list()).error?.code).toBe("unauthorized");
  });

  it("names who is on the account", async () => {
    const members = await propgate.members.list();

    // A tenant minted without a signup has no member, which is a real state and
    // not an error: `createdBy` on its keys is null for the same reason.
    expect(members.error).toBeNull();
    expect(members.data).toEqual([]);
  });
});
