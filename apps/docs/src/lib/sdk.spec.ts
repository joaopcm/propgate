import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PROPGATE_ERROR_CODES, Propgate } from "@propgate/sdk";
import { describe, expect, it } from "vitest";

/**
 * The SDK pages against the SDK, and the API reference against both.
 *
 * `cli.spec.ts` does this for the CLI, and the reasoning is identical: prose is
 * a person's job, but a method that was renamed, an example that would not
 * compile, and an endpoint whose page never learned the SDK can call it are not.
 *
 * A published example naming a method that does not exist is worse than no
 * example — a reader concludes the client cannot do the thing, or pastes it and
 * gets `propgate.domains.delete is not a function`. Both are silent until
 * somebody hits them.
 */

const DOCS = join(process.cwd(), "src/app/(docs)");
const SDK_DOCS = join(DOCS, "sdk");
const API_DOCS = join(DOCS, "api");

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/**
 * The snippets as *rendered*, not as source.
 *
 * Imported rather than read off disk, for the reason `cli.spec.ts` gives:
 * reading the file gets the TypeScript around the strings too, and every
 * explanatory header comment becomes a phantom example.
 */
async function examplesIn(directory: string): Promise<string> {
  const modules = await Promise.all(
    walk(directory)
      .filter((path) => path.endsWith("_snippets.ts"))
      .map(
        async (path) => await (import(path) as Promise<Record<string, unknown>>)
      )
  );

  return modules
    .flatMap((module) => Object.values(module))
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function proseIn(directory: string): string {
  return walk(directory)
    .filter((path) => path.endsWith(".mdx"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

const SDK_TEXT = `${proseIn(SDK_DOCS)}\n${await examplesIn(SDK_DOCS)}`;
const API_TEXT = `${proseIn(API_DOCS)}\n${await examplesIn(API_DOCS)}`;

/**
 * Every method the client exposes, found by reflection.
 *
 * A hand-kept list would only prove this file agrees with itself, and the
 * failure being guarded against is somebody adding a method and not the page.
 */
const RESOURCES = [
  "apiKeys",
  "checks",
  "domains",
  "members",
  "profiles",
  "webhooks",
] as const;

const client = new Propgate("pg_docs_key");

function methods(): readonly string[] {
  const found = RESOURCES.flatMap((resource) => {
    const prototype = Object.getPrototypeOf(client[resource]) as object;

    return Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== "constructor")
      .map((name) => `${resource}.${name}`);
  });

  return [...found, "health"];
}

/** `propgate.domains.listAll(` and `propgate.health(`, as written in the docs. */
const CALL = /\bpropgate\.([A-Za-z]+(?:\.[A-Za-z]+)?)\s*\(/g;

function callsIn(text: string): readonly string[] {
  return [...new Set([...text.matchAll(CALL)].map((match) => match[1] ?? ""))];
}

describe("the SDK pages", () => {
  it("finds the examples at all, so a silent zero cannot pass", () => {
    // Without this, every assertion below goes vacuously green the moment the
    // extraction stops matching anything.
    expect(callsIn(SDK_TEXT).length).toBeGreaterThan(15);
  });

  it("calls only methods the client actually has", () => {
    const real = new Set(methods());
    const invented = callsIn(`${SDK_TEXT}\n${API_TEXT}`).filter(
      (call) => !real.has(call)
    );

    expect(invented).toEqual([]);
  });

  it("shows every method the client exposes", () => {
    const shown = new Set(callsIn(SDK_TEXT));
    const undocumented = methods().filter((method) => !shown.has(method));

    expect(undocumented).toEqual([]);
  });

  it("names every error code a consumer can receive", () => {
    /**
     * The table on `/sdk/errors` is the only place a code is explained, and a
     * code that arrives at runtime and appears nowhere in the docs is exactly
     * the moment somebody starts parsing `message` instead.
     */
    const missing = PROPGATE_ERROR_CODES.filter(
      (code) => !SDK_TEXT.includes(code)
    );

    expect(missing).toEqual([]);
  });
});

/**
 * Endpoint pages whose request cannot be made from the SDK.
 *
 * Signup is a mailbox flow — a six-digit code out, a key back — and a
 * server-side client is on the wrong side of it. Both pages say so and point at
 * the CLI. Any other page missing an SDK tab is an oversight.
 */
const NO_SDK_EQUIVALENT = ["accounts/signup", "accounts/confirm"];

describe("the API reference", () => {
  const pages = walk(API_DOCS)
    .filter((path) => path.endsWith("page.mdx"))
    .filter((path) => !path.endsWith(join("api", "page.mdx")))
    .map((path) => ({
      body: readFileSync(path, "utf8"),
      name: path.slice(API_DOCS.length + 1, -"/page.mdx".length),
    }));

  it("collects the endpoint pages", () => {
    expect(pages.length).toBeGreaterThan(15);
  });

  it.each(pages.filter((page) => !NO_SDK_EQUIVALENT.includes(page.name)))(
    "$name offers an SDK example beside the cURL one",
    ({ body }) => {
      expect(body).toContain('label: "SDK"');
    }
  );

  it("excludes only the two flows the SDK deliberately omits", () => {
    // A stale exclusion is how a page silently stops being covered.
    const names = new Set(pages.map((page) => page.name));

    expect(NO_SDK_EQUIVALENT.filter((name) => !names.has(name))).toEqual([]);
  });
});
