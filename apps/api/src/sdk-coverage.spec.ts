import type { Database } from "@propgate/db";
import { createRecordingMailer } from "@propgate/emails";
import { Propgate } from "@propgate/sdk";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

const UNUSED_DB = {} as Database;

const app = createApp({
  db: UNUSED_DB,
  mailer: createRecordingMailer(),
  resolver: { address: "127.0.0.1", port: 53, transport: "udp" },
});

const NOT_IN_SDK: ReadonlySet<string> = new Set([
  "GET /openapi.json",
  "POST /v1/signup",
  "POST /v1/signup/confirm",
]);

interface Route {
  readonly method: string;
  readonly path: string;
}

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

    expect(unknown).toEqual([]);
  });

  it("excludes only what it says it excludes", () => {
    const registered = new Set(
      routes().map((route) => `${route.method} ${route.path}`)
    );

    expect([...NOT_IN_SDK].filter((entry) => !registered.has(entry))).toEqual(
      []
    );
  });
});
