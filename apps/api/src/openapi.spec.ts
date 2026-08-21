import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "@propgate/db";
import { createRecordingMailer } from "@propgate/emails";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import {
  documentedOperations,
  openApiDocument,
  openApiPathToHono,
} from "./openapi";

/**
 * The published spec against the live router.
 *
 * A path that exists only in one of them is the failure this file exists to
 * catch: either an endpoint an agent cannot discover, or a documented call that
 * 404s. Descriptions and operationIds are the function-calling surface — an
 * operation without either is a stub, not a spec.
 */

/**
 * Never queried. Same trick as `sdk-coverage.spec.ts`: the app is constructed
 * only to be read.
 */
const UNUSED_DB = {} as Database;

const app = createApp({
  db: UNUSED_DB,
  mailer: createRecordingMailer(),
  resolver: { address: "127.0.0.1", port: 53, transport: "udp" },
});

const WEB_OPENAPI = join(process.cwd(), "../web/public/openapi.json");

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

describe("OpenAPI document", () => {
  it("is OpenAPI 3.1 with a unique operationId and a description on every operation", () => {
    expect(openApiDocument.openapi).toBe("3.1.0");

    const operations = documentedOperations();
    const ids = operations.map((operation) => operation.operationId);

    expect(ids).toEqual([...new Set(ids)]);

    for (const operation of operations) {
      expect(
        operation.operationId.length,
        operation.operationId
      ).toBeGreaterThan(0);
      expect(
        operation.description.length,
        operation.operationId
      ).toBeGreaterThan(40);
    }
  });

  it("documents every route the API serves", () => {
    const documented = new Set(
      documentedOperations().map(
        (operation) =>
          `${operation.method} ${openApiPathToHono(operation.path)}`
      )
    );
    const uncovered = routes()
      .filter((route) => !documented.has(`${route.method} ${route.path}`))
      .map((route) => `${route.method} ${route.path}`);

    expect(uncovered).toEqual([]);
  });

  it("documents nothing the API does not serve", () => {
    const registered = new Set(
      routes().map((route) => `${route.method} ${route.path}`)
    );
    const extra = documentedOperations()
      .filter(
        (operation) =>
          !registered.has(
            `${operation.method} ${openApiPathToHono(operation.path)}`
          )
      )
      .map((operation) => `${operation.method} ${operation.path}`);

    expect(extra).toEqual([]);
  });

  it("matches the copy published at propgate.dev/openapi.json", () => {
    // Agents that only look at the marketing origin still need a spec. The
    // file in apps/web/public is that copy; this is what stops it rotting
    // after a route ships.
    expect(existsSync(WEB_OPENAPI), WEB_OPENAPI).toBe(true);

    const published = JSON.parse(readFileSync(WEB_OPENAPI, "utf8")) as unknown;

    expect(published).toEqual(openApiDocument);
  });
});
