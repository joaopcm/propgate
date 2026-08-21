import { describe, expect, it } from "vitest";
import { docsError, jsonErrorResponse } from "./json-error";

describe("docsError", () => {
  it("uses the envelope agents can switch on", () => {
    const body = docsError("not_found", "/v1/nope is not a path");

    expect(body.data).toBeNull();
    expect(body.meta).toBeNull();
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toContain("nope");
    expect(body.error.hint).toContain("/openapi.json");
  });
});

describe("jsonErrorResponse", () => {
  it("returns JSON with the status", async () => {
    const response = jsonErrorResponse(
      404,
      "not_found",
      "/v1/missing is not a propgate docs API path"
    );
    const body = (await response.json()) as ReturnType<typeof docsError>;

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body.error.code).toBe("not_found");
    expect(body.error.hint.length).toBeGreaterThan(20);
  });
});
