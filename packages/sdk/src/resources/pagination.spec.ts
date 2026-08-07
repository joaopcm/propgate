import { describe, expect, it } from "vitest";
import { Propgate } from "../client";
import { callAt, envelope, refusal, stub } from "../test/stub";

/**
 * Walking a cursor to the end, and the two ways that can go wrong.
 */

const BASE = "https://api.example.test";

function client(fetchImpl: ReturnType<typeof stub>): Propgate {
  return new Propgate("pg_test_key", { baseUrl: BASE, fetch: fetchImpl.fetch });
}

describe("listAll", () => {
  it("follows nextCursor and returns every page's rows in order", async () => {
    const transport = stub([
      envelope([{ id: "dom_1" }], { nextCursor: "dom_1" }),
      envelope([{ id: "dom_2" }], { nextCursor: "dom_2" }),
      envelope([{ id: "dom_3" }], { nextCursor: null }),
    ]);

    const { data, error, meta } = await client(transport).domains.listAll();

    expect(error).toBeNull();
    expect(data?.map((domain) => domain.id)).toEqual([
      "dom_1",
      "dom_2",
      "dom_3",
    ]);
    // A walk has no page to describe, so there is no meta to report.
    expect(meta).toBeNull();
    expect(transport.calls.map((call) => call.url)).toEqual([
      `${BASE}/v1/domains?limit=200`,
      `${BASE}/v1/domains?cursor=dom_1&limit=200`,
      `${BASE}/v1/domains?cursor=dom_2&limit=200`,
    ]);
  });

  it("asks for the largest page the server will give", async () => {
    // Fifty round trips for ten thousand domains rather than two hundred. The
    // number is what `GET /v1/domains` clamps to, not a guess.
    const transport = stub([envelope([], { nextCursor: null })]);

    await client(transport).domains.listAll();

    expect(callAt(transport, 0).url).toContain("limit=200");
  });

  it("stops if the server ever echoes the cursor it was handed", async () => {
    /**
     * A tripwire past where any good response goes. Nothing produces this today
     * — both walks move strictly forward — but a server that ever did would spin
     * here forever, silently, and the guard costs nothing to leave in.
     */
    const transport = stub([
      envelope([{ id: "dom_1" }], { nextCursor: "same" }),
    ]);

    const { data } = await client(transport).domains.listAll();

    expect(transport.calls).toHaveLength(2);
    expect(data).toHaveLength(2);
  });

  it("reports a failure mid-walk rather than a short list", async () => {
    // The dangerous shape: returning the first page and no error would look
    // exactly like a tenant with three domains.
    const transport = stub([
      envelope([{ id: "dom_1" }], { nextCursor: "dom_1" }),
      refusal("Internal server error", 500),
    ]);

    const { data, error } = await client(transport).domains.listAll();

    expect(data).toBeNull();
    expect(error?.statusCode).toBe(500);
  });

  it("walks deliveries the same way", async () => {
    const transport = stub([
      envelope([{ id: "dlv_2" }], { nextCursor: "dlv_2" }),
      envelope([{ id: "dlv_1" }], { nextCursor: null }),
    ]);

    const { data } = await client(transport).webhooks.listAllDeliveries("wh_1");

    expect(data).toHaveLength(2);
    expect(callAt(transport, 1).url).toContain("cursor=dlv_2");
  });
});
