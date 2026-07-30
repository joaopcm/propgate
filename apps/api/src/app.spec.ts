import { describe, expect, it } from "vitest";
import app from "./app";

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
