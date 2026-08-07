import { afterEach, describe, expect, it } from "vitest";
import { Propgate } from "./client";
import { PropgateError } from "./error";
import { callAt, envelope, json, refusal, stub } from "./test/stub";

/**
 * Constructing a client, and the two calls that need no key.
 */

const BASE = "https://api.example.test";
const ORIGINAL_KEY = process.env.PROPGATE_API_KEY;

afterEach(() => {
  // Deleted rather than blanked: assigning `undefined` stores the string
  // "undefined", and every later request goes out as `Bearer undefined`.
  if (ORIGINAL_KEY === undefined) {
    delete process.env.PROPGATE_API_KEY;
  } else {
    process.env.PROPGATE_API_KEY = ORIGINAL_KEY;
  }
});

describe("where the key comes from", () => {
  it("falls back to PROPGATE_API_KEY", async () => {
    process.env.PROPGATE_API_KEY = "pg_from_env";

    const transport = stub([envelope([])]);

    await new Propgate(undefined, {
      baseUrl: BASE,
      fetch: transport.fetch,
    }).members.list();

    expect(callAt(transport, 0).headers.authorization).toBe(
      "Bearer pg_from_env"
    );
  });

  it("prefers the key it was handed", async () => {
    process.env.PROPGATE_API_KEY = "pg_from_env";

    const transport = stub([envelope([])]);

    await new Propgate("pg_explicit", {
      baseUrl: BASE,
      fetch: transport.fetch,
    }).members.list();

    expect(callAt(transport, 0).headers.authorization).toBe(
      "Bearer pg_explicit"
    );
  });

  it("refuses an authenticated call with no key, without spending a round trip", async () => {
    delete process.env.PROPGATE_API_KEY;

    const transport = stub([envelope([])]);
    const { error } = await new Propgate(undefined, {
      baseUrl: BASE,
      fetch: transport.fetch,
    }).members.list();

    expect(error).toBeInstanceOf(PropgateError);
    expect(error?.code).toBe("missing_api_key");
    // The message has to name the two ways to fix it: an agent reading
    // "unauthorized" has nothing to act on.
    expect(error?.message).toContain("PROPGATE_API_KEY");
    expect(transport.calls).toHaveLength(0);
  });

  it("runs a public check with no key at all", async () => {
    delete process.env.PROPGATE_API_KEY;

    const transport = stub([
      envelope(
        { domain: "acme.test", verdict: "pass" },
        { resolver: "1.1.1.1:53" }
      ),
    ]);
    const { data, error, meta } = await new Propgate(undefined, {
      baseUrl: BASE,
      fetch: transport.fetch,
    }).checks.run({ domain: "acme.test" });

    expect(error).toBeNull();
    expect(data?.verdict).toBe("pass");
    expect(meta?.resolver).toBe("1.1.1.1:53");
    expect(callAt(transport, 0).headers.authorization).toBeUndefined();
  });

  it("treats a blank key as no key", async () => {
    delete process.env.PROPGATE_API_KEY;

    const transport = stub([envelope([])]);
    const { error } = await new Propgate("   ", {
      baseUrl: BASE,
      fetch: transport.fetch,
    }).members.list();

    expect(error?.code).toBe("missing_api_key");
  });
});

describe("meta", () => {
  it("comes back beside the data rather than being folded into it", async () => {
    const transport = stub([envelope({ id: "dom_1" }, { created: false })]);

    const { data, meta } = await new Propgate("pg_k", {
      baseUrl: BASE,
      fetch: transport.fetch,
    }).domains.create({ name: "acme.test", profile: "sending" });

    // `created: false` is how a partner's retry is told apart from a second
    // customer — and the signal that expectations in the request were not
    // applied, because that is `update`'s job.
    expect(data?.id).toBe("dom_1");
    expect(meta).toEqual({ created: false });
  });

  it("is null when the route sent none", async () => {
    const transport = stub([envelope({ id: "dom_1" })]);

    const { meta } = await new Propgate("pg_k", {
      baseUrl: BASE,
      fetch: transport.fetch,
    }).domains.get("dom_1");

    expect(meta).toBeNull();
  });
});

describe("health", () => {
  it("reads the one route that does not answer with an envelope", async () => {
    const transport = stub([json({ status: "ok" })]);

    const { data, error } = await new Propgate(undefined, {
      baseUrl: BASE,
      fetch: transport.fetch,
    }).health();

    expect(error).toBeNull();
    expect(data?.status).toBe("ok");
  });

  it("treats an unhealthy status as an error and not as data", async () => {
    const transport = stub([json({ status: "degraded" }, { status: 503 })]);

    const { data, error } = await new Propgate(undefined, {
      baseUrl: BASE,
      fetch: transport.fetch,
    }).health({ timeoutMs: 50 });

    expect(data).toBeNull();
    expect(error?.code).toBe("server_error");
    expect(error?.message).toContain("degraded");
  });

  it("says so when something other than the API answers", async () => {
    const transport = stub([new Response("OK", { status: 200 })]);

    const { error } = await new Propgate(undefined, {
      baseUrl: BASE,
      fetch: transport.fetch,
    }).health();

    expect(error?.code).toBe("invalid_response");
  });
});

describe("errors", () => {
  it("are thrown by the caller if that is what the caller prefers", () => {
    // An `Error` subclass, so `throw result.error` keeps a stack and
    // `instanceof` works across the boundary.
    const error = new PropgateError({
      code: "conflict",
      message: "acme.test is already registered as dom_1",
      statusCode: 409,
    });

    expect(() => {
      throw error;
    }).toThrow("acme.test is already registered as dom_1");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("PropgateError");
  });

  it("carry the API's own message, not a status line", async () => {
    const transport = stub([refusal('no profile named "sending"', 422)]);

    const { error } = await new Propgate("pg_k", {
      baseUrl: BASE,
      fetch: transport.fetch,
    }).domains.create({ name: "acme.test", profile: "sending" });

    expect(error?.code).toBe("invalid_request");
    expect(error?.statusCode).toBe(422);
    expect(error?.message).toBe('no profile named "sending"');
  });
});
