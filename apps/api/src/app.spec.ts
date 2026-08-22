import { describe, expect, it } from "vitest";
import { createApp } from "./app";

const app = createApp({ resolver: { address: "127.0.0.1", port: 53 } });

describe("GET /health", () => {
  it("reports ok so the container healthcheck has something to hit", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
  });
});

describe("unmatched routes", () => {
  it("404s with a JSON error an agent can act on", async () => {
    const res = await app.request("/v1/nope");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    await expect(res.json()).resolves.toEqual({
      data: null,
      error: {
        code: "not_found",
        hint: expect.stringContaining("/openapi.json"),
        message: "no route for GET /v1/nope",
      },
      meta: null,
    });
  });
});

describe("GET /openapi.json", () => {
  it("returns the OpenAPI document, not the envelope", async () => {
    const res = await app.request("/openapi.json");

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const body = (await res.json()) as { openapi: string; paths: object };

    expect(body.openapi).toBe("3.1.0");
    expect(body.paths).toHaveProperty("/v1/checks");
  });
});

describe("CORS", () => {
  it("lets a browser on another origin use the public checker", async () => {
    const res = await app.request("/v1/checks", {
      headers: { origin: "https://propgate.dev" },
      method: "OPTIONS",
    });

    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("offers nothing to a browser aiming at the authenticated routes", async () => {
    const res = await app.request("/v1/domains", {
      headers: { origin: "https://example.com" },
      method: "OPTIONS",
    });

    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
