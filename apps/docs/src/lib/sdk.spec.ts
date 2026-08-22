import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  MAX_RETRY_WAIT_MS,
  PROPGATE_ERROR_CODES,
  Propgate,
} from "@propgate/sdk";
import { describe, expect, it } from "vitest";

const DOCS = join(process.cwd(), "src/app/(docs)");
const SDK_DOCS = join(DOCS, "sdk");
const API_DOCS = join(DOCS, "api");

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

async function snippetsIn(directory: string): Promise<readonly string[]> {
  const modules = await Promise.all(
    walk(directory)
      .filter((path) => path.endsWith("_snippets.ts"))
      .map(
        async (path) => await (import(path) as Promise<Record<string, unknown>>)
      )
  );

  return modules
    .flatMap((module) => Object.values(module))
    .filter((value): value is string => typeof value === "string");
}

async function examplesIn(directory: string): Promise<string> {
  return (await snippetsIn(directory)).join("\n");
}

function proseIn(directory: string): string {
  return walk(directory)
    .filter((path) => path.endsWith(".mdx"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

const SDK_TEXT = `${proseIn(SDK_DOCS)}\n${await examplesIn(SDK_DOCS)}`;
const API_TEXT = `${proseIn(API_DOCS)}\n${await examplesIn(API_DOCS)}`;

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

const CALL = /\bpropgate\.([A-Za-z]+(?:\.[A-Za-z]+)?)\s*\(/g;

function callsIn(text: string): readonly string[] {
  return [...new Set([...text.matchAll(CALL)].map((match) => match[1] ?? ""))];
}

describe("the SDK pages", () => {
  it("finds the examples at all, so a silent zero cannot pass", () => {
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

  it("checks the timestamp in every example that verifies a signature", async () => {
    const examples = (await snippetsIn(SDK_DOCS)).filter((snippet) =>
      snippet.includes("verifyPayload")
    );

    expect(examples.length).toBeGreaterThan(0);

    for (const example of examples) {
      expect(example).toContain("TOLERANCE_SECONDS");
    }
  });

  it("states a worst case that the client's own defaults produce", () => {
    const worstCaseMs =
      DEFAULT_TIMEOUT_MS * (1 + DEFAULT_MAX_RETRIES) +
      DEFAULT_MAX_RETRIES * MAX_RETRY_WAIT_MS;

    expect(SDK_TEXT).toContain(`${worstCaseMs / 1000} seconds`);
  });

  it("names every error code a consumer can receive", () => {
    const missing = PROPGATE_ERROR_CODES.filter(
      (code) => !SDK_TEXT.includes(code)
    );

    expect(missing).toEqual([]);
  });
});

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
    const names = new Set(pages.map((page) => page.name));

    expect(NO_SDK_EQUIVALENT.filter((name) => !names.has(name))).toEqual([]);
  });
});
