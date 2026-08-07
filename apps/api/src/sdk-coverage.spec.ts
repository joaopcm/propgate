import type { Database } from "@propgate/db";
import { createRecordingMailer } from "@propgate/emails";
import { Propgate } from "@propgate/sdk";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

/**
 * Every route this API serves, against the SDK method that reaches it.
 *
 * "Full API coverage" is a claim, and a claim in a README is one nobody re-runs.
 * This is the receipt: the app's own router is the list, so adding a route
 * fails here until `@propgate/sdk` can call it. That is the failure worth
 * catching — a customer who cannot do from the SDK what they can do with curl
 * writes their own client, and then we have two.
 *
 * It costs nothing to run: the app is constructed only to be *read*, no handler
 * executes, and the SDK talks to a `fetch` that records the request and answers
 * from memory. Which is why it lives in the ungated project rather than beside
 * the end-to-end spec that needs three container tiers.
 */

/**
 * Never queried. `createApp` passes `db` to route factories and to
 * `bearerAuth`, both of which only close over it — nothing touches it until a
 * request runs, and no request runs here.
 */
const UNUSED_DB = {} as Database;

/**
 * Constructed *with* a mailer so the signup routes are mounted and have to be
 * excluded explicitly below.
 *
 * Leaving the mailer out would unmount them, and the exclusion would then be
 * invisible rather than written down — which is the difference between "the SDK
 * deliberately omits signup" and "nobody noticed signup exists".
 */
const app = createApp({
  db: UNUSED_DB,
  mailer: createRecordingMailer(),
  resolver: { address: "127.0.0.1", port: 53, transport: "udp" },
});

/**
 * The two routes the SDK deliberately does not cover.
 *
 * Signup is a mailbox flow: it sends a six-digit code to an address and takes it
 * back to mint the first key. A server-side SDK is on the wrong side of that —
 * whoever is holding it already has a key — and the flow that hands out
 * credentials belongs in the CLI and the dashboard, where a human is present to
 * read the mail. `@propgate/cli` covers both, and this list is where to remove
 * an entry from if that ever stops being true.
 */
const NOT_IN_SDK: ReadonlySet<string> = new Set([
  "POST /v1/signup",
  "POST /v1/signup/confirm",
]);

interface Route {
  readonly method: string;
  readonly path: string;
}

/**
 * The routes with handlers, ignoring middleware.
 *
 * `app.use(path, ...)` registers under the `ALL` method with a wildcard path, so
 * `/v1/domains/*` is authentication rather than an endpoint. Including it would
 * make the coverage check trivially satisfiable by any call to any domains
 * route.
 */
function routes(): readonly Route[] {
  const seen = new Set<string>();

  return app.routes
    .filter((route) => route.method !== "ALL")
    .map((route) => ({ method: route.method, path: route.path }))
    .filter((route) => {
      const key = `${route.method} ${route.path}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    });
}

/** Whether a concrete request path matches a registered pattern. */
function matches(pattern: string, path: string): boolean {
  const expected = pattern.split("/");
  const actual = path.split("/");

  if (expected.length !== actual.length) {
    return false;
  }

  return expected.every(
    (part, index) => part.startsWith(":") || part === actual[index]
  );
}

/**
 * Every request the SDK makes when every method is called once.
 *
 * The list is written as calls rather than as strings on purpose: a path
 * hand-copied here would prove only that this file agrees with itself.
 */
async function requestsTheSdkMakes(): Promise<readonly Route[]> {
  const made: Route[] = [];
  const client = new Propgate("pg_coverage_key", {
    baseUrl: "https://api.example.test",
    fetch: (url, init) => {
      made.push({
        method: init.method ?? "GET",
        path: new URL(url).pathname,
      });

      return Promise.resolve(
        Response.json({ data: [], error: null, meta: null })
      );
    },
  });

  await client.health();
  await client.checks.run({ domain: "acme.test" });
  await client.members.list();
  await client.apiKeys.create({ name: "ci" });
  await client.apiKeys.list();
  await client.apiKeys.revoke("key_1");
  await client.profiles.create({
    key: "sending",
    requirements: [{ check: "dmarc", key: "dmarc" }],
  });
  await client.profiles.get("sending");
  await client.domains.create({ name: "acme.test", profile: "sending" });
  await client.domains.list();
  await client.domains.get("dom_1");
  await client.domains.update("dom_1", { profile: "sending" });
  await client.domains.check("dom_1");
  await client.domains.timeline("dom_1");
  await client.domains.remove("dom_1");
  await client.webhooks.create({ url: "https://acme.test/hook" });
  await client.webhooks.list();
  await client.webhooks.get("wh_1");
  await client.webhooks.update("wh_1", { disabled: true });
  await client.webhooks.rotateSecret("wh_1");
  await client.webhooks.listDeliveries("wh_1");
  await client.webhooks.remove("wh_1");

  return made;
}

describe("@propgate/sdk against this API's router", () => {
  it("reaches every route the API serves", async () => {
    const made = await requestsTheSdkMakes();
    const uncovered = routes()
      .filter((route) => !NOT_IN_SDK.has(`${route.method} ${route.path}`))
      .filter(
        (route) =>
          !made.some(
            (request) =>
              request.method === route.method &&
              matches(route.path, request.path)
          )
      )
      .map((route) => `${route.method} ${route.path}`);

    // Named rather than counted: "expected 22 to be 23" sends the next reader
    // looking for which one, and the answer is already here.
    expect(uncovered).toEqual([]);
  });

  it("calls nothing this API does not serve", async () => {
    const made = await requestsTheSdkMakes();
    const registered = routes();
    const unknown = made
      .filter(
        (request) =>
          !registered.some(
            (route) =>
              route.method === request.method &&
              matches(route.path, request.path)
          )
      )
      .map((request) => `${request.method} ${request.path}`);

    // The other direction, and the cheaper of the two to get wrong: a method
    // pointing at a path that was renamed is a 404 nobody sees until a customer
    // calls it.
    expect(unknown).toEqual([]);
  });

  it("excludes only what it says it excludes", () => {
    // A route in the exclusion list that no longer exists means the list is
    // stale, and a stale exclusion is how a route silently stops being covered.
    const registered = new Set(
      routes().map((route) => `${route.method} ${route.path}`)
    );

    expect([...NOT_IN_SDK].filter((entry) => !registered.has(entry))).toEqual(
      []
    );
  });
});
