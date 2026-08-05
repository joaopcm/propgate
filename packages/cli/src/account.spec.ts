import { mkdtempSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAccountCommand } from "./account";
import { configPath, readConfig } from "./config";

/**
 * The account commands, against a real HTTP server.
 *
 * A `node:http` listener rather than a stubbed `fetch`, for the same reason the
 * webhook delivery spec runs one: the thing worth testing is what goes over the
 * wire — the method, the path, the bearer header — and a stub asserts only that
 * the code called the function the test expected it to call.
 */

interface Received {
  readonly authorization: string | undefined;
  readonly body: string;
  readonly method: string;
  readonly url: string;
}

let server: Server;
let baseUrl: string;
let received: Received[];
/** status and body, keyed by `METHOD path`. */
let replies: Map<string, { body: unknown; status: number }>;
let written: string[];
let originalXdg: string | undefined;
let originalKey: string | undefined;

function reply(route: string, body: unknown, status = 200): void {
  replies.set(route, { body, status });
}

/** The permission bits as octal digits — `& 0o777` spelled without a bitwise op. */
function permissions(path: string): string {
  return statSync(path).mode.toString(8).slice(-3);
}

beforeEach(async () => {
  received = [];
  replies = new Map();
  written = [];

  originalXdg = process.env.XDG_CONFIG_HOME;
  originalKey = process.env.PROPGATE_API_KEY;
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "propgate-cli-"));
  // Deleted, not assigned undefined: assigning it would set the literal string
  // "undefined", which the CLI would then treat as a perfectly good API key.
  delete process.env.PROPGATE_API_KEY;

  // Captured rather than silenced, so the specs can assert on what a person sees.
  const capture = ((chunk: unknown) => {
    written.push(String(chunk));

    return true;
  }) as typeof process.stdout.write;

  vi.spyOn(process.stdout, "write").mockImplementation(capture);
  vi.spyOn(process.stderr, "write").mockImplementation(capture);

  server = createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString(),
        method: String(request.method),
        url: String(request.url),
      });

      const route = `${request.method} ${String(request.url).split("?")[0]}`;
      const canned = replies.get(route);

      response.writeHead(canned?.status ?? 404, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify(
          canned?.body ?? {
            data: null,
            error: { message: `nothing canned for ${route}` },
            meta: null,
          }
        )
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  vi.restoreAllMocks();

  if (originalXdg === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalXdg;
  }

  if (originalKey !== undefined) {
    process.env.PROPGATE_API_KEY = originalKey;
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function run(...argv: string[]): Promise<number> {
  return runAccountCommand([...argv, "--api-url", baseUrl]);
}

function output(): string {
  return written.join("");
}

describe("signup", () => {
  it("posts the address and does not claim a send", async () => {
    reply("POST /v1/signup", {
      data: { object: "signup", status: "pending" },
      error: null,
      meta: null,
    });

    const code = await run("signup", "--email", "me@example.com");

    expect(code).toBe(0);
    expect(received[0]?.method).toBe("POST");
    expect(JSON.parse(String(received[0]?.body))).toEqual({
      email: "me@example.com",
    });

    // The API answers identically whether or not the address is known, so the CLI
    // must not translate that into "we sent you a code" — that would be inventing
    // a fact this command cannot see.
    expect(output()).toContain("If me@example.com can receive mail");
    expect(output()).not.toContain("We sent");
  });

  it("needs an email", async () => {
    expect(await run("signup")).toBe(1);
    expect(received).toHaveLength(0);
  });

  it("sends no bearer token", async () => {
    reply("POST /v1/signup", { data: {}, error: null, meta: null });
    await run("signup", "--email", "me@example.com");

    // It is unauthenticated by design; sending an empty Authorization header would
    // be a 401 from the middleware rather than a signup.
    expect(received[0]?.authorization).toBeUndefined();
  });
});

describe("confirm", () => {
  beforeEach(() => {
    reply("POST /v1/signup/confirm", {
      data: { apiKey: "pg_live_abc123", created: true, tenantId: "t_1" },
      error: null,
      meta: null,
    });
  });

  it("stores the key, owner-readable only, and says it is the last look", async () => {
    const code = await run(
      "confirm",
      "--email",
      "me@example.com",
      "--code",
      "123456"
    );

    expect(code).toBe(0);
    expect(readConfig().apiKey).toBe("pg_live_abc123");
    expect(permissions(configPath())).toBe("600");

    // Both halves matter: that it is saved, and that this is the only sight of it.
    expect(output()).toContain("pg_live_abc123");
    expect(output()).toContain("will not be shown again");
  });

  it("remembers a non-default api url so later commands need no flag", async () => {
    await run("confirm", "--email", "me@example.com", "--code", "123456");

    expect(readConfig().apiUrl).toBe(baseUrl);
  });

  it("reports a refused code and stores nothing", async () => {
    reply(
      "POST /v1/signup/confirm",
      {
        data: null,
        error: { message: "that code is not valid or has already been used" },
        meta: null,
      },
      409
    );

    const code = await run(
      "confirm",
      "--email",
      "me@example.com",
      "--code",
      "000000"
    );

    expect(code).toBe(1);
    expect(output()).toContain("already been used");
    expect(readConfig().apiKey).toBeUndefined();
  });
});

describe("keys", () => {
  const KEY_ONE = {
    createdAt: "2026-08-01T10:00:00.000Z",
    id: "key_one",
    lastUsedAt: null,
    name: "prod",
    prefix: "pg_live_Aaaa",
    revoked: false,
  };
  const KEY_TWO = {
    createdAt: "2026-08-02T10:00:00.000Z",
    id: "key_two",
    lastUsedAt: "2026-08-03T10:00:00.000Z",
    name: "ci",
    prefix: "pg_live_Bbbb",
    revoked: false,
  };
  const KEYS = [KEY_ONE, KEY_TWO];

  beforeEach(() => {
    process.env.PROPGATE_API_KEY = "pg_live_caller";
    reply("GET /v1/api-keys", { data: KEYS, error: null, meta: null });
  });

  it("carries the bearer token", async () => {
    await run("keys", "list");

    expect(received[0]?.authorization).toBe("Bearer pg_live_caller");
  });

  it("resolves a prefix to an id before deleting", async () => {
    reply("DELETE /v1/api-keys/key_two", {
      data: { ...KEY_TWO, revoked: true },
      error: null,
      meta: { alreadyRevoked: false },
    });

    const code = await run("keys", "revoke", "pg_live_Bbbb");

    expect(code).toBe(0);
    // The route takes an id on purpose — a four-character prefix carries no unique
    // index — so the translation happens here, where ambiguity can be reported.
    expect(received.map((entry) => `${entry.method} ${entry.url}`)).toEqual([
      "GET /v1/api-keys",
      "DELETE /v1/api-keys/key_two",
    ]);
  });

  it("accepts an id directly", async () => {
    reply("DELETE /v1/api-keys/key_one", {
      data: KEY_ONE,
      error: null,
      meta: {},
    });

    expect(await run("keys", "revoke", "key_one")).toBe(0);
  });

  it("refuses an ambiguous prefix without deleting anything", async () => {
    reply("GET /v1/api-keys", {
      data: [KEY_ONE, { ...KEY_TWO, id: "key_three", prefix: "pg_live_Aaaa" }],
      error: null,
      meta: null,
    });

    const code = await run("keys", "revoke", "pg_live_Aaaa");

    expect(code).toBe(1);
    // Revoking the wrong key is not a thing to do on a coin flip, so it names the
    // candidates and asks for an id.
    expect(output()).toContain("matches 2 keys");
    expect(output()).toContain("key_one");
    expect(received.some((entry) => entry.method === "DELETE")).toBe(false);
  });

  it("says so for a prefix nobody has", async () => {
    expect(await run("keys", "revoke", "pg_live_Zzzz")).toBe(1);
    expect(output()).toContain("no key matches");
    expect(received.some((entry) => entry.method === "DELETE")).toBe(false);
  });

  it("reports an already-revoked key as unchanged", async () => {
    reply("DELETE /v1/api-keys/key_two", {
      data: { ...KEY_TWO, revoked: true },
      error: null,
      meta: { alreadyRevoked: true },
    });

    await run("keys", "revoke", "pg_live_Bbbb");

    expect(output()).toContain("Nothing changed");
  });

  it("passes the last-key refusal through in the API's own words", async () => {
    reply(
      "DELETE /v1/api-keys/key_two",
      {
        data: null,
        error: {
          message:
            "this is your last active api key; revoking it would lock you out",
        },
        meta: null,
      },
      409
    );

    expect(await run("keys", "revoke", "pg_live_Bbbb")).toBe(1);
    // Re-phrasing it here would mean two places to keep in step.
    expect(output()).toContain("last active api key");
  });

  it("does not store a newly created key over the caller's own", async () => {
    reply(
      "POST /v1/api-keys",
      {
        data: { key: "pg_live_fresh", prefix: "pg_live_Cccc" },
        error: null,
        meta: null,
      },
      200
    );

    await run("keys", "create", "another");

    expect(output()).toContain("pg_live_fresh");
    // Silently replacing the stored key would move the caller's footing out from
    // under their next command without being asked.
    expect(readConfig().apiKey).toBeUndefined();
  });
});

describe("domains", () => {
  beforeEach(() => {
    process.env.PROPGATE_API_KEY = "pg_live_caller";
  });

  it("registers with a name and a profile", async () => {
    reply(
      "POST /v1/domains",
      {
        data: { id: "dom_1", name: "example.com", state: "pending" },
        error: null,
        meta: null,
      },
      200
    );

    const code = await run(
      "domains",
      "add",
      "example.com",
      "--profile",
      "sending"
    );

    expect(code).toBe(0);
    expect(JSON.parse(String(received[0]?.body))).toEqual({
      name: "example.com",
      profile: "sending",
    });
    // `state: pending` reads as a failure unless this is said out loud.
    expect(output()).toContain("Nothing has been checked yet");
  });

  it("needs a profile", async () => {
    expect(await run("domains", "add", "example.com")).toBe(1);
    expect(received).toHaveLength(0);
  });

  it("says something for an empty list", async () => {
    reply("GET /v1/domains", { data: [], error: null, meta: null });

    expect(await run("domains", "list")).toBe(0);
    // Printing nothing looks like a failure.
    expect(output()).toContain("No domains yet");
  });

  it("passes a state filter through as a query parameter", async () => {
    reply("GET /v1/domains", { data: [], error: null, meta: null });

    await run("domains", "list", "--state", "failed");

    expect(received[0]?.url).toBe("/v1/domains?state=failed");
  });
});

describe("credentials", () => {
  it("explains how to get a key rather than sending an empty header", async () => {
    const code = await run("keys", "list");

    expect(code).toBe(1);
    expect(output()).toContain("propgate signup");
    // No request at all: a 401 from the server would be a worse error message
    // than the one we can write here.
    expect(received).toHaveLength(0);
  });

  it("names the url when nothing is listening", async () => {
    process.env.PROPGATE_API_KEY = "pg_live_caller";

    const code = await runAccountCommand([
      "keys",
      "list",
      "--api-url",
      "http://127.0.0.1:1",
    ]);

    expect(code).toBe(1);
    // The usual cause is a stale --api-url, so the message says which one it used.
    expect(output()).toContain("could not reach http://127.0.0.1:1");
  });

  it("says when the answer is not JSON at all", async () => {
    process.env.PROPGATE_API_KEY = "pg_live_caller";

    // A proxy error page, a captive portal, a tunnel that is down.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server = createServer((_request, response) => {
      response.writeHead(502, { "content-type": "text/html" });
      response.end("<html>Bad Gateway</html>");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );

    const code = await runAccountCommand([
      "keys",
      "list",
      "--api-url",
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    ]);

    expect(code).toBe(1);
    expect(output()).toContain("is that the propgate API?");
  });
});
