import { describe, expect, it } from "vitest";
import type { DocsErrorBody } from "./json-error";
import { handleDocsRequest, VARY_ACCEPT } from "./negotiate";
import { notFoundMarkdown } from "./not-found-markdown";

function request(path: string, accept?: string, method = "GET"): Request {
  const headers = new Headers();

  if (accept !== undefined) {
    headers.set("Accept", accept);
  }

  return new Request(`https://docs.propgate.dev${path}`, { headers, method });
}

function textAsset(body: string, status = 200, type = "text/html"): Response {
  return new Response(body, {
    headers: { "content-type": type },
    status,
  });
}

describe("handleDocsRequest", () => {
  it("serves markdown with Vary: Accept when asked", async () => {
    const response = await handleDocsRequest(
      request("/quickstart", "text/markdown"),
      (incoming) => {
        expect(new URL(incoming.url).pathname).toBe("/quickstart.md");

        return textAsset("# Quickstart", 200, "text/markdown; charset=utf-8");
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("vary")).toBe(VARY_ACCEPT);
    expect(await response.text()).toContain("# Quickstart");
  });

  it("returns a markdown 404 with recovery links", async () => {
    const response = await handleDocsRequest(
      request("/does-not-exist", "text/markdown"),
      () => textAsset("missing", 404)
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(await response.text()).toBe(notFoundMarkdown("/does-not-exist"));
  });

  it("returns JSON errors for unknown catalog paths", async () => {
    const response = await handleDocsRequest(request("/v1/nope"), () =>
      textAsset("html 404", 404)
    );
    const body = (await response.json()) as DocsErrorBody;

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body.error.code).toBe("not_found");
    expect(body.error.hint).toContain("openapi.json");
  });

  it("refuses non-GET on catalog paths with a JSON error", async () => {
    const response = await handleDocsRequest(
      request("/v1/status", undefined, "POST"),
      () => {
        throw new Error("assets should not be fetched");
      }
    );
    const body = (await response.json()) as DocsErrorBody;

    expect(response.status).toBe(405);
    expect(body.error.code).toBe("method_not_allowed");
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  it("serves catalog JSON with an application/json type", async () => {
    const response = await handleDocsRequest(request("/v1/status"), () =>
      textAsset('{"data":{"status":"ok"}}', 200, "text/plain")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("vary")).toBe(VARY_ACCEPT);
  });

  it("adds Vary on HTML page responses so caches key on Accept", async () => {
    const response = await handleDocsRequest(request("/"), () =>
      textAsset("<html>home</html>")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toBe(VARY_ACCEPT);
    expect(await response.text()).toContain("home");
  });
});
