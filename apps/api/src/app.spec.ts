import { describe, expect, it } from "vitest";
import { createApp } from "./app";

// No database: the public checker is the whole product without one, and these
// specs prove the app still stands up that way.
const app = createApp({ resolver: { address: "127.0.0.1", port: 53 } });

describe("GET /health", () => {
  it("reports ok so the container healthcheck has something to hit", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
  });
});

describe("unmatched routes", () => {
  it("404s rather than throwing", async () => {
    const res = await app.request("/v1/nope");

    expect(res.status).toBe(404);
  });
});

describe("CORS", () => {
  it("lets a browser on another origin use the public checker", async () => {
    // The checker is served from propgate.dev and calls api.propgate.dev. With
    // no CORS header it does not work at all, which is the sort of thing that
    // is only discovered after a deploy.
    const res = await app.request("/v1/checks", {
      headers: { origin: "https://propgate.dev" },
      method: "OPTIONS",
    });

    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("offers nothing to a browser aiming at the authenticated routes", async () => {
    // A bearer token belongs in a server-to-server call. A browser that can
    // reach these is a browser holding a key that should never have left a
    // backend, and permissive CORS here would invite exactly that.
    const res = await app.request("/v1/domains", {
      headers: { origin: "https://example.com" },
      method: "OPTIONS",
    });

    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
