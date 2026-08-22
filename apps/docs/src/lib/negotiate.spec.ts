import { describe, expect, it } from "vitest";
import type { DocsErrorBody } from "./json-error";
import { handleDocsRequest, isAssetPath, VARY_ACCEPT } from "./negotiate";
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

describe("isAssetPath", () => {
  it("recognises build artefacts", () => {
    expect(isAssetPath("/_next/static/chunks/0a-6hmdrq391z.css")).toBe(true);
    expect(isAssetPath("/_next/static/chunks/0q~b3v_0dyzra.js")).toBe(true);
    expect(
      isAssetPath(
        "/_next/static/media/5c285b27cdda1fe8-s.p.0yo6-5yoeeudq.woff2"
      )
    ).toBe(true);
  });

  it("recognises a file asked for by name", () => {
    expect(isAssetPath("/favicon.ico")).toBe(true);
    expect(isAssetPath("/openapi.json")).toBe(true);
    expect(isAssetPath("/robots.txt")).toBe(true);
  });

  it("does not treat a page as an asset", () => {
    expect(isAssetPath("/")).toBe(false);
    expect(isAssetPath("/quickstart")).toBe(false);
    expect(isAssetPath("/api/domains/register")).toBe(false);
    expect(isAssetPath("/taxonomy/spf-void-lookup")).toBe(false);
  });

  it("does not treat a markdown twin as an asset", () => {
    expect(isAssetPath("/quickstart.md")).toBe(false);
    expect(isAssetPath("/index.md")).toBe(false);
  });
});

describe("assets bypass negotiation", () => {
  const CSS = "/_next/static/chunks/0a-6hmdrq391z.css";

  it("serves a stylesheet as itself for a Chrome stylesheet request", async () => {
    const response = await handleDocsRequest(
      request(CSS, "text/css,*/*;q=0.1"),
      (incoming) => {
        expect(new URL(incoming.url).pathname).toBe(CSS);

        return textAsset("body{color:red}", 200, "text/css");
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/css");
    expect(await response.text()).toBe("body{color:red}");
  });

  it("serves a stylesheet as itself even when markdown is asked for by name", async () => {
    const response = await handleDocsRequest(
      request(CSS, "text/markdown"),
      (incoming) => {
        expect(new URL(incoming.url).pathname).toBe(CSS);

        return textAsset("body{color:red}", 200, "text/css");
      }
    );

    expect(response.headers.get("content-type")).toBe("text/css");
  });

  it("passes a real 404 on an asset through untouched", async () => {
    const response = await handleDocsRequest(
      request("/_next/static/chunks/gone.js", "*/*"),
      () => textAsset("not found", 404, "text/plain")
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("text/plain");
  });
});

describe("a browser page request", () => {
  it("gets HTML for a Chrome document Accept", async () => {
    const chrome =
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8";
    const response = await handleDocsRequest(
      request("/quickstart", chrome),
      (incoming) => {
        expect(new URL(incoming.url).pathname).toBe("/quickstart");

        return textAsset('<html lang="en"></html>');
      }
    );

    expect(response.headers.get("content-type")).toBe("text/html");
  });

  it("gets HTML for a bare wildcard", async () => {
    const response = await handleDocsRequest(
      request("/", "*/*"),
      (incoming) => {
        expect(new URL(incoming.url).pathname).toBe("/");

        return textAsset('<html lang="en"></html>');
      }
    );

    expect(response.headers.get("content-type")).toBe("text/html");
  });
});
