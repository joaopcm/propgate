import { describe, expect, it } from "vitest";
import { Propgate } from "../client";
import { callAt, envelope, stub } from "../test/stub";

/**
 * Every method, against the request it is supposed to make.
 *
 * One table rather than a `describe` per resource, because the thing worth
 * protecting is uniform: a method that reaches the wrong route, or forgets to
 * send its body, is the same bug wherever it lives. The table is also the
 * cheapest place to see the whole surface at once.
 *
 * What this cannot see is whether the route on the other end exists or answers
 * this shape. `apps/api/src/sdk-coverage.spec.ts` compares this list against the
 * API's own router, and `sdk.e2e.spec.ts` drives the real thing.
 */

const KEY = "pg_test_key";
const BASE = "https://api.example.test";

interface Call {
  readonly body?: unknown;
  readonly invoke: (client: Propgate) => Promise<unknown>;
  readonly method: string;
  readonly name: string;
  readonly url: string;
}

const CALLS: readonly Call[] = [
  {
    body: { domain: "acme.test", expectsMail: false },
    invoke: (client) =>
      client.checks.run({ domain: "acme.test", expectsMail: false }),
    method: "POST",
    name: "checks.run",
    url: "/v1/checks",
  },
  {
    body: { name: "acme.test", profile: "sending" },
    invoke: (client) =>
      client.domains.create({ name: "acme.test", profile: "sending" }),
    method: "POST",
    name: "domains.create",
    url: "/v1/domains",
  },
  {
    invoke: (client) => client.domains.list({ state: "verified" }),
    method: "GET",
    name: "domains.list",
    url: "/v1/domains?state=verified",
  },
  {
    invoke: (client) => client.domains.get("dom_1"),
    method: "GET",
    name: "domains.get",
    url: "/v1/domains/dom_1",
  },
  {
    body: { profile: "full-mail" },
    invoke: (client) =>
      client.domains.update("dom_1", { profile: "full-mail" }),
    method: "PATCH",
    name: "domains.update",
    url: "/v1/domains/dom_1",
  },
  {
    invoke: (client) => client.domains.check("dom_1"),
    method: "POST",
    name: "domains.check",
    url: "/v1/domains/dom_1/checks",
  },
  {
    invoke: (client) => client.domains.timeline("dom_1", { limit: 10 }),
    method: "GET",
    name: "domains.timeline",
    url: "/v1/domains/dom_1/timeline?limit=10",
  },
  {
    invoke: (client) => client.domains.remove("dom_1"),
    method: "DELETE",
    name: "domains.remove",
    url: "/v1/domains/dom_1",
  },
  {
    body: { key: "sending", requirements: [{ check: "dmarc", key: "dmarc" }] },
    invoke: (client) =>
      client.profiles.create({
        key: "sending",
        requirements: [{ check: "dmarc", key: "dmarc" }],
      }),
    method: "POST",
    name: "profiles.create",
    url: "/v1/profiles",
  },
  {
    invoke: (client) => client.profiles.get("sending"),
    method: "GET",
    name: "profiles.get",
    url: "/v1/profiles/sending",
  },
  {
    body: { url: "https://acme.test/hook" },
    invoke: (client) =>
      client.webhooks.create({ url: "https://acme.test/hook" }),
    method: "POST",
    name: "webhooks.create",
    url: "/v1/webhooks",
  },
  {
    invoke: (client) => client.webhooks.list(),
    method: "GET",
    name: "webhooks.list",
    url: "/v1/webhooks",
  },
  {
    invoke: (client) => client.webhooks.get("wh_1"),
    method: "GET",
    name: "webhooks.get",
    url: "/v1/webhooks/wh_1",
  },
  {
    body: { disabled: true },
    invoke: (client) => client.webhooks.update("wh_1", { disabled: true }),
    method: "PATCH",
    name: "webhooks.update",
    url: "/v1/webhooks/wh_1",
  },
  {
    invoke: (client) => client.webhooks.remove("wh_1"),
    method: "DELETE",
    name: "webhooks.remove",
    url: "/v1/webhooks/wh_1",
  },
  {
    body: { windowHours: 0 },
    invoke: (client) =>
      client.webhooks.rotateSecret("wh_1", { windowHours: 0 }),
    method: "POST",
    name: "webhooks.rotateSecret",
    url: "/v1/webhooks/wh_1/secret",
  },
  {
    invoke: (client) =>
      client.webhooks.listDeliveries("wh_1", { status: "failed" }),
    method: "GET",
    name: "webhooks.listDeliveries",
    url: "/v1/webhooks/wh_1/deliveries?status=failed",
  },
  {
    body: { name: "ci" },
    invoke: (client) => client.apiKeys.create({ name: "ci" }),
    method: "POST",
    name: "apiKeys.create",
    url: "/v1/api-keys",
  },
  {
    invoke: (client) => client.apiKeys.list(),
    method: "GET",
    name: "apiKeys.list",
    url: "/v1/api-keys",
  },
  {
    invoke: (client) => client.apiKeys.revoke("key_1"),
    method: "DELETE",
    name: "apiKeys.revoke",
    url: "/v1/api-keys/key_1",
  },
  {
    invoke: (client) => client.members.list(),
    method: "GET",
    name: "members.list",
    url: "/v1/members",
  },
  {
    invoke: (client) => client.health(),
    method: "GET",
    name: "health",
    url: "/health",
  },
];

describe("every method's request", () => {
  for (const call of CALLS) {
    it(`${call.name} is ${call.method} ${call.url}`, async () => {
      const transport = stub([envelope({ status: "ok" })]);

      await call.invoke(
        new Propgate(KEY, { baseUrl: BASE, fetch: transport.fetch })
      );

      expect(transport.calls).toHaveLength(1);
      expect(callAt(transport, 0)).toMatchObject({
        method: call.method,
        url: `${BASE}${call.url}`,
      });
      expect(callAt(transport, 0).body).toEqual(call.body);
    });
  }

  it("has a `listAll` beside each of the two paginated lists", async () => {
    /**
     * Named separately rather than folded into the table because they make more
     * than one request by design, which is the whole point of them. The walk
     * itself is `pagination.spec.ts`.
     */
    const transport = stub([envelope([], { nextCursor: null })]);
    const client = new Propgate(KEY, { baseUrl: BASE, fetch: transport.fetch });

    await client.domains.listAll({ state: "failed" });
    await client.webhooks.listAllDeliveries("wh_1", { status: "pending" });

    expect(transport.calls.map((call) => call.url)).toEqual([
      `${BASE}/v1/domains?state=failed&limit=200`,
      `${BASE}/v1/webhooks/wh_1/deliveries?status=pending&limit=200`,
    ]);
  });
});
