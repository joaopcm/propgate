import { mkdtempSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configPath, readConfig } from "./config";
import { main } from "./index";

/**
 * Every command that talks to the API, against a real HTTP server.
 *
 * A `node:http` listener rather than a stubbed `fetch`, for the same reason the
 * webhook delivery spec runs one: the thing worth testing is what goes over the
 * wire — the method, the path, the bearer header, the body — and a stub asserts
 * only that the code called the function the test expected it to call.
 *
 * Driven through `main`, so the registry lookup, the per-command option table and
 * `resolve` are all in the path. A command that exists but is unreachable from
 * the dispatcher would pass a unit test and fail a user.
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
let originalNoInput: string | undefined;

function reply(route: string, body: unknown, status = 200): void {
  replies.set(route, { body, status });
}

function ok(data: unknown, meta: unknown = null): unknown {
  return { data, error: null, meta };
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
  originalNoInput = process.env.PROPGATE_NO_INPUT;
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "propgate-cli-"));
  // Belt and braces. The runner's stdin is not a terminal, so nothing would
  // prompt anyway — but a spec that hangs waiting for input is the single worst
  // failure mode this suite could have, and one env var removes the possibility.
  process.env.PROPGATE_NO_INPUT = "1";
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

  if (originalKey === undefined) {
    delete process.env.PROPGATE_API_KEY;
  } else {
    process.env.PROPGATE_API_KEY = originalKey;
  }

  if (originalNoInput === undefined) {
    delete process.env.PROPGATE_NO_INPUT;
  } else {
    process.env.PROPGATE_NO_INPUT = originalNoInput;
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function run(...argv: string[]): Promise<number> {
  return main([...argv, "--api-url", baseUrl]);
}

function output(): string {
  return written.join("");
}

function authenticated(): void {
  process.env.PROPGATE_API_KEY = "pg_live_caller";
}

function calls(): string[] {
  return received.map((entry) => `${entry.method} ${entry.url}`);
}

describe("dispatch", () => {
  it("prints help rather than guessing when given nothing", async () => {
    expect(await main([])).toBe(0);
    expect(output()).toContain("propgate check <domain>");
  });

  it("reports the version, which also takes no positionals", async () => {
    // The regression this exists for: `--version` and "no arguments" look
    // identical to a positional count, so a help branch checked first ate it and
    // `propgate --version` printed usage in every release that shipped.
    expect(await main(["--version"])).toBe(0);
    expect(output()).not.toContain("propgate check <domain>");

    written = [];

    expect(await main(["-v"])).toBe(0);
    expect(output()).not.toContain("propgate check <domain>");
  });

  it("lists a family's commands when the family is named alone", async () => {
    expect(await main(["webhooks"])).toBe(0);
    expect(output()).toContain("propgate webhooks deliveries");
    expect(output()).toContain("propgate webhooks rotate");
  });

  it("rejects an unknown command", async () => {
    expect(await main(["inspect", "example.com"])).toBe(64);
  });

  it("rejects an unknown subcommand and shows the family", async () => {
    expect(await main(["domains", "destroy", "x"])).toBe(64);
    expect(output()).toContain('domains has no "destroy" command');
  });

  it("shows a command's own help", async () => {
    expect(await main(["webhooks", "rotate", "--help"])).toBe(0);
    expect(output()).toContain("--window-hours");
  });
});

describe("signup", () => {
  it("posts the address and does not claim a send", async () => {
    reply("POST /v1/signup", ok({ object: "signup", status: "pending" }));

    const code = await run("signup", "--email", "me@example.com");

    expect(code).toBe(0);
    expect(JSON.parse(String(received[0]?.body))).toEqual({
      email: "me@example.com",
    });

    // The API answers identically whether or not the address is known, so the CLI
    // must not translate that into "we sent you a code" — that would be inventing
    // a fact this command cannot see.
    expect(output()).toContain("If me@example.com can receive mail");
    expect(output()).not.toContain("We sent");
  });

  it("names the missing flag and exits 64", async () => {
    // 64, not 1. A script cannot tell a typo from a rejection when both are 1,
    // and this used to be 1 while the identical mistake on `check` was 64.
    expect(await run("signup")).toBe(64);
    expect(output()).toContain("signup needs --email");
    expect(received).toHaveLength(0);
  });

  it("refuses something that is not an address before sending it", async () => {
    expect(await run("signup", "--email", "nope")).toBe(64);
    expect(received).toHaveLength(0);
  });

  it("sends no bearer token", async () => {
    reply("POST /v1/signup", ok({}));
    await run("signup", "--email", "me@example.com");

    // It is unauthenticated by design; sending an empty Authorization header would
    // be a 401 from the middleware rather than a signup.
    expect(received[0]?.authorization).toBeUndefined();
  });
});

describe("confirm", () => {
  beforeEach(() => {
    reply(
      "POST /v1/signup/confirm",
      ok({ apiKey: "pg_live_abc123", created: true, tenantId: "t_1" })
    );
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

  it("refuses a code that is not six digits without spending it", async () => {
    expect(
      await run("confirm", "--email", "me@example.com", "--code", "12")
    ).toBe(64);
    expect(received).toHaveLength(0);
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

  beforeEach(() => {
    authenticated();
    reply("GET /v1/api-keys", ok([KEY_ONE, KEY_TWO]));
  });

  it("carries the bearer token", async () => {
    await run("keys", "list");

    expect(received[0]?.authorization).toBe("Bearer pg_live_caller");
  });

  it("resolves a prefix to an id before deleting", async () => {
    reply(
      "DELETE /v1/api-keys/key_two",
      ok({ ...KEY_TWO, revoked: true }, { alreadyRevoked: false })
    );

    expect(await run("keys", "revoke", "pg_live_Bbbb")).toBe(0);
    // The route takes an id on purpose — a four-character prefix carries no unique
    // index — so the translation happens here, where ambiguity can be reported.
    expect(calls()).toEqual([
      "GET /v1/api-keys",
      "DELETE /v1/api-keys/key_two",
    ]);
  });

  it("accepts an id directly", async () => {
    reply("DELETE /v1/api-keys/key_one", ok(KEY_ONE, {}));

    expect(await run("keys", "revoke", "key_one")).toBe(0);
  });

  it("refuses an ambiguous prefix without deleting anything", async () => {
    reply(
      "GET /v1/api-keys",
      ok([KEY_ONE, { ...KEY_TWO, id: "key_three", prefix: "pg_live_Aaaa" }])
    );

    expect(await run("keys", "revoke", "pg_live_Aaaa")).toBe(1);
    // Revoking the wrong key is not a thing to do on a coin flip, so it names the
    // candidates and asks for an id.
    expect(output()).toContain("matches 2 keys");
    expect(received.some((entry) => entry.method === "DELETE")).toBe(false);
  });

  it("says so for a prefix nobody has", async () => {
    expect(await run("keys", "revoke", "pg_live_Zzzz")).toBe(1);
    expect(output()).toContain("no key matches");
    expect(received.some((entry) => entry.method === "DELETE")).toBe(false);
  });

  it("reports an already-revoked key as unchanged", async () => {
    reply(
      "DELETE /v1/api-keys/key_two",
      ok({ ...KEY_TWO, revoked: true }, { alreadyRevoked: true })
    );

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
      ok({ key: "pg_live_fresh", prefix: "pg_live_C" })
    );

    await run("keys", "create", "another");

    expect(output()).toContain("pg_live_fresh");
    // Silently replacing the stored key would move the caller's footing out from
    // under their next command without being asked.
    expect(readConfig().apiKey).toBeUndefined();
  });
});

describe("members", () => {
  it("lists who is on the account", async () => {
    authenticated();
    reply(
      "GET /v1/members",
      ok([{ createdAt: "2026-08-01T10:00:00.000Z", email: "a@b.co", id: "m1" }])
    );

    expect(await run("members", "list")).toBe(0);
    expect(output()).toContain("a@b.co");
  });
});

describe("profiles", () => {
  beforeEach(authenticated);

  it("builds a definition from --require", async () => {
    reply(
      "POST /v1/profiles",
      ok({ id: "p1", key: "sending", requirements: [], version: 1 })
    );

    const code = await run(
      "profiles",
      "create",
      "--key",
      "sending",
      "--require",
      "root:delegation",
      "--require",
      "mail:spf:include=_spf.resend.com"
    );

    expect(code).toBe(0);
    expect(JSON.parse(String(received[0]?.body))).toEqual({
      key: "sending",
      requirements: [
        { check: "delegation", key: "root" },
        { check: "spf", include: "_spf.resend.com", key: "mail" },
      ],
    });
  });

  it("refuses a malformed requirement before sending it", async () => {
    expect(
      await run("profiles", "create", "--key", "x", "--require", "k1:dkim")
    ).toBe(64);
    expect(output()).toContain("dkim needs a selector");
    expect(received).toHaveLength(0);
  });

  it("needs something to build from when nobody can be asked", async () => {
    expect(await run("profiles", "create", "--key", "x")).toBe(64);
    expect(output()).toContain("--require or --file");
    expect(received).toHaveLength(0);
  });

  it("refuses --file alongside the flags it duplicates", async () => {
    expect(
      await run("profiles", "create", "--key", "x", "--file", "p.json")
    ).toBe(64);
    expect(received).toHaveLength(0);
  });

  it("says a new version is a new version", async () => {
    reply(
      "POST /v1/profiles",
      ok({ id: "p2", key: "sending", requirements: [], version: 3 })
    );

    await run("profiles", "create", "--key", "sending", "--require", "r:mx");

    // Domains pin the version they were registered against, so "created" would be
    // the wrong word and an unhelpful one.
    expect(output()).toContain("version 3");
    expect(output()).toContain("registered against");
  });

  it("reads one back", async () => {
    reply(
      "GET /v1/profiles/sending",
      ok({
        id: "p1",
        key: "sending",
        requirements: [{ check: "dkim", key: "k1", selector: "resend" }],
        version: 1,
      })
    );

    expect(await run("profiles", "get", "sending")).toBe(0);
    expect(output()).toContain("selector=resend");
  });
});

describe("domains", () => {
  const DOMAIN = {
    createdAt: "2026-08-01T10:00:00.000Z",
    externalId: null,
    id: "0195c7a2-0000-7000-8000-000000000001",
    lastCheckedAt: null,
    name: "example.com",
    requirements: null,
    requirementsMet: null,
    requirementsTotal: null,
    state: "pending",
    verdict: null,
  };

  beforeEach(authenticated);

  it("registers with a name and a profile", async () => {
    reply("POST /v1/domains", ok(DOMAIN));

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

  it("needs a profile, and says so without asking the server", async () => {
    expect(await run("domains", "add", "example.com")).toBe(64);
    expect(received).toHaveLength(0);
  });

  it("says something for an empty list", async () => {
    reply("GET /v1/domains", ok([]));

    expect(await run("domains", "list")).toBe(0);
    // Printing nothing looks like a failure.
    expect(output()).toContain("No domains yet");
  });

  it("passes every filter through as a query parameter", async () => {
    reply("GET /v1/domains", ok([]));

    await run(
      "domains",
      "list",
      "--state",
      "failed",
      "--external-id",
      "cust_1",
      "--limit",
      "10"
    );

    expect(received[0]?.url).toBe(
      "/v1/domains?externalId=cust_1&limit=10&state=failed"
    );
  });

  it("rejects a state the API does not have, before asking it", async () => {
    expect(await run("domains", "list", "--state", "sideways")).toBe(64);
    expect(received).toHaveLength(0);
  });

  it("follows the cursor to the end for --all", async () => {
    let page = 0;

    await new Promise<void>((done) => server.close(() => done()));
    server = createServer((request, response) => {
      received.push({
        authorization: request.headers.authorization,
        body: "",
        method: String(request.method),
        url: String(request.url),
      });
      page += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          data: [{ ...DOMAIN, name: `page${page}.example.com` }],
          error: null,
          meta: { nextCursor: page < 3 ? `cursor${page}` : null },
        })
      );
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));

    const code = await main([
      "domains",
      "list",
      "--all",
      "--api-url",
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    ]);

    expect(code).toBe(0);
    expect(received).toHaveLength(3);
    // Asks for the server's maximum, so a walk is one round trip per 200 rows.
    expect(received[0]?.url).toContain("limit=200");
    expect(received[1]?.url).toContain("cursor=cursor1");
    expect(output()).toContain("page3.example.com");
  });

  it("stops rather than spinning if a cursor ever repeats", async () => {
    // A tripwire past where any good response goes. A server that answered with
    // the cursor it was handed would otherwise loop here in silence.
    await new Promise<void>((done) => server.close(() => done()));
    server = createServer((request, response) => {
      received.push({
        authorization: undefined,
        body: "",
        method: String(request.method),
        url: String(request.url),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          data: [DOMAIN],
          error: null,
          meta: { nextCursor: "stuck" },
        })
      );
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));

    const code = await main([
      "domains",
      "list",
      "--all",
      "--api-url",
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    ]);

    expect(code).toBe(0);
    expect(received).toHaveLength(2);
  });

  it("refuses --all with --cursor rather than picking one", async () => {
    expect(await run("domains", "list", "--all", "--cursor", "abc")).toBe(64);
    expect(received).toHaveLength(0);
  });

  it("reads one domain, with its per-requirement results", async () => {
    reply(
      `GET /v1/domains/${DOMAIN.id}`,
      ok({
        ...DOMAIN,
        requirements: [{ key: "mail", satisfied: false, verdict: "fail" }],
        requirementsMet: 0,
        requirementsTotal: 1,
        state: "failed",
        verdict: "fail",
      })
    );

    expect(await run("domains", "get", DOMAIN.id)).toBe(0);
    expect(output()).toContain("mail");
    expect(output()).toContain("fail");
  });

  it("re-checks a registered domain", async () => {
    reply(`POST /v1/domains/${DOMAIN.id}/checks`, ok(DOMAIN));

    expect(await run("domains", "check", DOMAIN.id)).toBe(0);
    expect(calls()).toEqual([`POST /v1/domains/${DOMAIN.id}/checks`]);
  });

  it("explains an empty timeline instead of printing nothing", async () => {
    reply(`GET /v1/domains/${DOMAIN.id}/timeline`, ok([]));

    expect(await run("domains", "timeline", DOMAIN.id)).toBe(0);
    // "Nothing has changed" is a different statement from "nothing has happened",
    // and only the first one is true of a domain checked hourly and never altered.
    expect(output()).toContain("Only differences are recorded");
  });

  it("shows what changed", async () => {
    reply(
      `GET /v1/domains/${DOMAIN.id}/timeline`,
      ok([
        {
          current: "v=spf1 include:new -all",
          observedAt: "2026-08-05T09:00:00.000Z",
          previous: "v=spf1 -all",
          requirementKey: "mail",
        },
      ])
    );

    await run("domains", "timeline", DOMAIN.id, "--limit", "5");

    expect(received[0]?.url).toBe(`/v1/domains/${DOMAIN.id}/timeline?limit=5`);
    expect(output()).toContain("→");
  });

  it("deletes", async () => {
    reply(
      `DELETE /v1/domains/${DOMAIN.id}`,
      ok({ deleted: true, id: DOMAIN.id })
    );

    expect(await run("domains", "delete", DOMAIN.id)).toBe(0);
    expect(output()).toContain("no longer tracked");
  });
});

describe("webhooks", () => {
  const ENDPOINT = {
    createdAt: "2026-08-01T10:00:00.000Z",
    disabled: false,
    events: [],
    id: "wh_1",
    url: "https://example.com/hooks",
  };

  beforeEach(authenticated);

  it("creates and shows the secret once", async () => {
    reply(
      "POST /v1/webhooks",
      ok({ ...ENDPOINT, secret: "whsec_abc" }, { created: true })
    );

    const code = await run(
      "webhooks",
      "create",
      "--url",
      "https://example.com/hooks",
      "--events",
      "domain.failed,domain.recovered"
    );

    expect(code).toBe(0);
    expect(JSON.parse(String(received[0]?.body))).toEqual({
      events: ["domain.failed", "domain.recovered"],
      url: "https://example.com/hooks",
    });
    expect(output()).toContain("whsec_abc");
    // The endpoint is idempotent on the URL and returns a secret only on the call
    // that created the row, so there is no second chance at it.
    expect(output()).toContain("Shown once");
  });

  it("says nothing changed when the url was already registered", async () => {
    reply("POST /v1/webhooks", ok(ENDPOINT, { created: false }));

    await run("webhooks", "create", "--url", "https://example.com/hooks");

    expect(output()).toContain("already registered");
    expect(output()).not.toContain("Shown once");
  });

  it("refuses a non-https url without asking the server", async () => {
    expect(
      await run("webhooks", "create", "--url", "http://example.com/hooks")
    ).toBe(64);
    expect(received).toHaveLength(0);
  });

  it("lets loopback through and leaves the decision to the server", async () => {
    /**
     * The https rule is a statement about a network, and loopback has none —
     * the same line browsers draw for secure contexts. Refusing it here would
     * mean the CLI could never talk to a self-hosted API, because this runs
     * before any request and the CLI cannot know what that server permits.
     * api.propgate.dev still refuses it, which is where the answer belongs.
     */
    reply("POST /v1/webhooks", ok(ENDPOINT), 201);

    expect(
      await run("webhooks", "create", "--url", "http://127.0.0.1:8080/hooks")
    ).toBe(0);
    expect(received).toHaveLength(1);
  });

  it("rejects an event the API does not have", async () => {
    expect(
      await run(
        "webhooks",
        "create",
        "--url",
        "https://example.com/h",
        "--events",
        "domain.exploded"
      )
    ).toBe(64);
    expect(received).toHaveLength(0);
  });

  it("reads empty events as all of them", async () => {
    reply("GET /v1/webhooks", ok([ENDPOINT]));

    await run("webhooks", "list");

    expect(output()).toContain("all events");
  });

  it("gets one", async () => {
    reply("GET /v1/webhooks/wh_1", ok(ENDPOINT));

    expect(await run("webhooks", "get", "wh_1")).toBe(0);
    expect(output()).toContain("https://example.com/hooks");
  });

  it("patches only what was asked for", async () => {
    reply("PATCH /v1/webhooks/wh_1", ok({ ...ENDPOINT, disabled: true }));

    expect(await run("webhooks", "update", "wh_1", "--state", "disabled")).toBe(
      0
    );
    expect(JSON.parse(String(received[0]?.body))).toEqual({ disabled: true });
  });

  it("changes the events without touching the state", async () => {
    reply("PATCH /v1/webhooks/wh_1", ok(ENDPOINT));

    await run("webhooks", "update", "wh_1", "--events", "domain.verified");

    // Leaving the state alone must not send `disabled: false`, which would turn
    // an events-only edit into an enable nobody asked for.
    expect(JSON.parse(String(received[0]?.body))).toEqual({
      events: ["domain.verified"],
    });
  });

  it("treats `unchanged` as leaving the state alone", async () => {
    reply("PATCH /v1/webhooks/wh_1", ok(ENDPOINT));

    await run(
      "webhooks",
      "update",
      "wh_1",
      "--state",
      "unchanged",
      "--events",
      "domain.failed"
    );

    expect(JSON.parse(String(received[0]?.body))).toEqual({
      events: ["domain.failed"],
    });
  });

  it("refuses an update that would change nothing", async () => {
    // A PATCH with an empty body is a request the server accepts and a mistake
    // the caller made. Saying so beats reporting success for a no-op.
    expect(await run("webhooks", "update", "wh_1")).toBe(64);
    expect(
      await run("webhooks", "update", "wh_1", "--state", "unchanged")
    ).toBe(64);
    expect(received).toHaveLength(0);
  });

  it("cannot be told to enable and disable at once", async () => {
    // One `select` rather than `--disable` plus `--enable`: the contradiction
    // the two-flag shape allowed is not expressible here at all.
    expect(await run("webhooks", "update", "wh_1", "--state", "sideways")).toBe(
      64
    );
    expect(received).toHaveLength(0);
  });

  it("rotates, and says when the old secret stops working", async () => {
    reply(
      "POST /v1/webhooks/wh_1/secret",
      ok(
        { id: "wh_1", object: "webhook_secret", secret: "whsec_new" },
        { previousSecretExpiresAt: "2026-08-07T10:00:00.000Z" }
      )
    );

    expect(await run("webhooks", "rotate", "wh_1", "--window-hours", "0")).toBe(
      0
    );
    expect(JSON.parse(String(received[0]?.body))).toEqual({ windowHours: "0" });
    expect(output()).toContain("whsec_new");
    expect(output()).toContain("deploy this one before then");
  });

  it("refuses a rotation window the API would reject", async () => {
    expect(
      await run("webhooks", "rotate", "wh_1", "--window-hours", "999")
    ).toBe(64);
    expect(received).toHaveLength(0);
  });

  it("lists deliveries with a status filter", async () => {
    reply(
      "GET /v1/webhooks/wh_1/deliveries",
      ok([
        {
          attempts: 3,
          createdAt: "2026-08-05T09:00:00.000Z",
          deliveredAt: null,
          domainId: "d1",
          event: "domain.failed",
          id: "del_1",
          lastError: "502 from endpoint",
          status: "failed",
        },
      ])
    );

    expect(
      await run("webhooks", "deliveries", "wh_1", "--status", "failed")
    ).toBe(0);
    expect(received[0]?.url).toBe("/v1/webhooks/wh_1/deliveries?status=failed");
    expect(output()).toContain("502 from endpoint");
  });

  it("deletes", async () => {
    reply("DELETE /v1/webhooks/wh_1", ok({ deleted: true, id: "wh_1" }));

    expect(await run("webhooks", "delete", "wh_1")).toBe(0);
  });
});

describe("check --remote", () => {
  const RESULT = {
    checks: [
      {
        findings: [
          {
            code: "SPF_SOURCE_NOT_AUTHORIZED",
            evidence: { expected: "include:x", observed: "nothing" },
            severity: "error",
          },
        ],
        kind: "spf",
        lookups: [
          {
            name: "example.com",
            purpose: "the SPF record",
            server: "1.1.1.1:53",
            status: "answered",
            type: 16,
          },
        ],
        verdict: "fail",
      },
    ],
    domain: "example.com",
    findings: [
      {
        code: "SPF_SOURCE_NOT_AUTHORIZED",
        evidence: { expected: "include:x", observed: "nothing" },
        severity: "error",
      },
    ],
    verdict: "fail",
  };

  it("asks the API and renders it the same way as a local run", async () => {
    reply("POST /v1/checks", ok(RESULT, { resolver: "1.1.1.1:53" }));

    const code = await run("check", "example.com", "--remote", "--only", "spf");

    // Exit 1 for an error-severity finding, exactly as the local path reports it.
    expect(code).toBe(1);
    expect(JSON.parse(String(received[0]?.body))).toEqual({
      checks: ["spf"],
      domain: "example.com",
    });
    expect(output()).toContain("SPF_SOURCE_NOT_AUTHORIZED");
  });

  it("needs no bearer token", async () => {
    reply("POST /v1/checks", ok(RESULT));
    await run("check", "example.com", "--remote");

    expect(received[0]?.authorization).toBeUndefined();
  });

  it("survives a diagnosis code this build has never heard of", async () => {
    // An API newer than the installed CLI. Printing the bare code is a worse
    // report than the summary and a far better one than a crash.
    reply(
      "POST /v1/checks",
      ok({
        ...RESULT,
        checks: [
          {
            ...RESULT.checks[0],
            findings: [
              {
                code: "SPF_INVENTED_TOMORROW",
                evidence: {},
                severity: "error",
              },
            ],
          },
        ],
        findings: [
          { code: "SPF_INVENTED_TOMORROW", evidence: {}, severity: "error" },
        ],
      })
    );

    expect(await run("check", "example.com", "--remote")).toBe(1);
    expect(output()).toContain("SPF_INVENTED_TOMORROW");
  });

  it("refuses --resolver, which the API cannot honour", async () => {
    expect(
      await run("check", "example.com", "--remote", "--resolver", "1.1.1.1")
    ).toBe(64);
    expect(received).toHaveLength(0);
  });

  it("refuses --api-url without --remote rather than ignoring it", async () => {
    // Silently ignoring it would let someone believe they had pointed this at a
    // local stack when it had resolved locally the whole time.
    expect(await run("check", "example.com")).toBe(64);
    expect(received).toHaveLength(0);
  });
});

describe("check <id>", () => {
  it("points at the command that re-checks a registered domain", async () => {
    const id = "0195c7a2-0000-7000-8000-000000000001";
    const code = await main(["check", id]);

    expect(code).toBe(64);
    expect(output()).toContain("looks like a domain id");
    expect(output()).toContain(`propgate domains check ${id}`);
    // Nothing over the wire either way. `domains check` writes state and can fire
    // a webhook, and reaching that by typing the wrong shape at the wrong verb is
    // exactly what this declines to do.
    expect(received).toHaveLength(0);
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
    authenticated();

    const code = await main([
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
    authenticated();

    // A proxy error page, a captive portal, a tunnel that is down.
    await new Promise<void>((done) => server.close(() => done()));
    server = createServer((_request, response) => {
      response.writeHead(502, { "content-type": "text/html" });
      response.end("<html>Bad Gateway</html>");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));

    const code = await main([
      "keys",
      "list",
      "--api-url",
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    ]);

    expect(code).toBe(1);
    expect(output()).toContain("is that the propgate API?");
  });
});
