import { describe, expect, it } from "vitest";
import { errorBody } from "./response";

describe("errorBody", () => {
  it("names the failure and says what to do next", () => {
    const body = errorBody(404, "no such route");

    expect(body).toEqual({
      code: "not_found",
      hint: expect.stringContaining("/openapi.json"),
      message: "no such route",
    });
  });

  it("keeps 422 as invalid_request, matching the SDK", () => {
    expect(errorBody(422, "domain is required").code).toBe("invalid_request");
    expect(errorBody(400, "domain is required").code).toBe("invalid_request");
  });

  it("lets a caller override the hint without losing the code", () => {
    const body = errorBody(401, "this API key has been revoked", {
      hint: "Mint a new key with POST /v1/api-keys.",
    });

    expect(body.code).toBe("unauthorized");
    expect(body.hint).toContain("POST /v1/api-keys");
  });
});
