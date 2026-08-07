import { describe, expect, it } from "vitest";
import { Propgate } from "./client";
import { callAt, envelope, json, refusal, silent, stub } from "./test/stub";

/**
 * What goes on the wire, and what happens when it comes back wrong.
 *
 * Driven through the public client rather than through `send` directly: the
 * retry policy is only worth anything if a resource cannot opt out of it, and a
 * spec that calls the transport by hand cannot tell whether one did.
 */

const KEY = "pg_test_key";
const BASE = "https://api.example.test";

function client(fetchImpl: ReturnType<typeof stub>, options = {}) {
  return new Propgate(KEY, {
    baseUrl: BASE,
    fetch: fetchImpl.fetch,
    ...options,
  });
}

describe("the request a call makes", () => {
  it("sends the key as a bearer token and asks for JSON", async () => {
    const transport = stub([envelope([])]);

    await client(transport).members.list();

    expect(callAt(transport, 0)).toMatchObject({
      method: "GET",
      url: `${BASE}/v1/members`,
    });
    expect(callAt(transport, 0).headers).toMatchObject({
      accept: "application/json",
      authorization: `Bearer ${KEY}`,
    });
  });

  it("declares a content type only when it is sending a body", async () => {
    const transport = stub([envelope([])]);

    await client(transport).members.list();

    expect(callAt(transport, 0).headers["content-type"]).toBeUndefined();

    const posting = stub([envelope({})]);

    await client(posting).apiKeys.create({ name: "ci" });

    expect(callAt(posting, 0).headers["content-type"]).toBe("application/json");
    expect(callAt(posting, 0).body).toEqual({ name: "ci" });
  });

  it("keeps one slash between the base url and the path", async () => {
    const transport = stub([envelope([])]);

    await new Propgate(KEY, {
      baseUrl: `${BASE}///`,
      fetch: transport.fetch,
    }).members.list();

    expect(callAt(transport, 0).url).toBe(`${BASE}/v1/members`);
  });

  it("escapes an id rather than pasting it into the path", async () => {
    const transport = stub([envelope({})]);

    await client(transport).domains.get("dom/../../v1/api-keys");

    expect(callAt(transport, 0).url).toBe(
      `${BASE}/v1/domains/dom%2F..%2F..%2Fv1%2Fapi-keys`
    );
  });

  it("omits query parameters that were not supplied", async () => {
    const transport = stub([envelope([], { nextCursor: null })]);

    await client(transport).domains.list({ limit: 10, state: "failed" });

    expect(callAt(transport, 0).url).toBe(
      `${BASE}/v1/domains?limit=10&state=failed`
    );
  });
});

describe("a response that is not this API", () => {
  it("names the URL rather than a position in a document nobody asked for", async () => {
    const transport = stub([
      new Response("<html>502 Bad Gateway</html>", { status: 200 }),
    ]);

    const { error } = await client(transport).members.list();

    expect(error?.code).toBe("invalid_response");
    expect(error?.message).toContain(`${BASE}/v1/members`);
  });

  it("refuses a JSON body that is not an envelope", async () => {
    const transport = stub([json({ members: [] })]);

    const { error } = await client(transport).members.list();

    expect(error?.code).toBe("invalid_response");
  });

  it("reports a status with no error message as the status", async () => {
    const transport = stub([
      json({ data: null, error: null, meta: null }, { status: 404 }),
    ]);

    const { error } = await client(transport).members.list();

    expect(error?.code).toBe("not_found");
    expect(error?.statusCode).toBe(404);
  });
});

describe("what may be retried", () => {
  it("rides out a rate limit the server said would clear", async () => {
    const transport = stub([
      refusal("too many checks; try again in 0s", 429, { "retry-after": "0" }),
      envelope({ domain: "acme.test" }, { resolver: "1.1.1.1:53" }),
    ]);

    const { data, error } = await client(transport).checks.run({
      domain: "acme.test",
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ domain: "acme.test" });
    expect(transport.calls).toHaveLength(2);
  });

  it("gives up on a rate limit that outlasts the wait it is allowed", async () => {
    /**
     * `Retry-After: 47` is a real answer from `POST /v1/domains/:id/checks`, and
     * honouring it inside the call would be a 47-second stall the caller never
     * asked for. The limit comes back instead, carrying the number, so the
     * caller can schedule against it.
     */
    const transport = stub([
      refusal("rate limit of 100 checks per minute exceeded", 429, {
        "retry-after": "47",
      }),
    ]);

    const { error } = await client(transport).domains.check("dom_1");

    expect(error?.code).toBe("rate_limited");
    expect(error?.retryAfterSeconds).toBe(47);
    expect(transport.calls).toHaveLength(1);
  });

  it("repeats a GET that failed to connect", async () => {
    const transport = stub([
      () => {
        throw new TypeError("fetch failed");
      },
    ]);

    const { error } = await client(transport, { maxRetries: 1 }).members.list();

    expect(error?.code).toBe("connection_error");
    expect(error?.message).toContain(`${BASE}/v1/members`);
    expect(transport.calls).toHaveLength(2);
  });

  it("never repeats a POST that may already have been applied", async () => {
    /**
     * The whole reason the policy is per method rather than per status. A second
     * `POST /v1/api-keys` after a timeout is a second key nobody knows about,
     * and no amount of backoff makes that safe.
     */
    const transport = stub([
      () => {
        throw new TypeError("fetch failed");
      },
    ]);

    const { error } = await client(transport).apiKeys.create({ name: "ci" });

    expect(error?.code).toBe("connection_error");
    expect(transport.calls).toHaveLength(1);
  });

  it("does not repeat a 500 on a POST either", async () => {
    const transport = stub([refusal("Internal server error", 500)]);

    const { error } = await client(transport).apiKeys.create({ name: "ci" });

    expect(error?.code).toBe("server_error");
    expect(transport.calls).toHaveLength(1);
  });

  it("repeats a 500 on a GET, up to maxRetries", async () => {
    const transport = stub([refusal("Internal server error", 500)]);

    const { error } = await client(transport, { maxRetries: 1 }).members.list();

    expect(error?.statusCode).toBe(500);
    expect(transport.calls).toHaveLength(2);
  });

  it("does nothing more than once when maxRetries is zero", async () => {
    const transport = stub([refusal("Internal server error", 500)]);

    const { error } = await client(transport, { maxRetries: 0 }).members.list();

    expect(error?.statusCode).toBe(500);
    expect(transport.calls).toHaveLength(1);
  });

  it("passes a 404 straight back rather than retrying it", async () => {
    const transport = stub([refusal("no such domain", 404)]);

    const { error } = await client(transport).domains.get("dom_missing");

    expect(error?.code).toBe("not_found");
    expect(error?.message).toBe("no such domain");
    expect(transport.calls).toHaveLength(1);
  });
});

describe("giving up", () => {
  it("times out naming the budget it was given", async () => {
    const transport = silent();

    const { error } = await client(transport, {
      maxRetries: 0,
      timeoutMs: 20,
    }).members.list();

    expect(error?.code).toBe("timeout");
    expect(error?.message).toContain("20ms");
  });

  it("reports a caller's abort as an abort, and does not retry it", async () => {
    const transport = silent();
    const controller = new AbortController();
    const pending = client(transport).members.list({
      signal: controller.signal,
    });

    controller.abort();

    const { error } = await pending;

    expect(error?.code).toBe("aborted");
    expect(transport.calls).toHaveLength(1);
  });

  it("lets a per-call timeout override the client's", async () => {
    const transport = silent();

    const { error } = await client(transport, {
      maxRetries: 0,
      timeoutMs: 30_000,
    }).members.list({ timeoutMs: 15 });

    expect(error?.message).toContain("15ms");
  });
});
