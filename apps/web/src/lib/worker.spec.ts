import { describe, expect, it } from "vitest";
import { handleRequest } from "../../worker";
import { MARKDOWN_CONTENT_TYPE, VARY_ACCEPT } from "./negotiate";
import { NOT_FOUND_MARKDOWN } from "./site";

function assets(files: Record<string, { body: string; type: string }>): {
  fetch: (input: Request | URL) => Promise<Response>;
} {
  return {
    fetch: (input) => {
      const url = input instanceof Request ? new URL(input.url) : input;
      const file = files[url.pathname];

      if (file === undefined) {
        return Promise.resolve(
          new Response("<html>404</html>", {
            headers: { "content-type": "text/html; charset=utf-8" },
            status: 404,
          })
        );
      }

      return Promise.resolve(
        new Response(file.body, {
          headers: { "content-type": file.type },
          status: 200,
        })
      );
    },
  };
}

const env = {
  ASSETS: assets({
    "/": { body: "<html><h1>propgate</h1></html>", type: "text/html" },
    "/about": { body: "<html>about</html>", type: "text/html" },
    "/about.md": { body: "# About propgate\n", type: "text/markdown" },
    "/index.md": { body: "# propgate\n", type: "text/markdown" },
    "/openapi.json": { body: "{}", type: "application/json" },
  }),
};

describe("handleRequest", () => {
  it("serves markdown with Vary: Accept when asked", async () => {
    const response = await handleRequest(
      new Request("https://propgate.dev/", {
        headers: { Accept: "text/markdown" },
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(MARKDOWN_CONTENT_TYPE);
    expect(response.headers.get("vary")).toBe(VARY_ACCEPT);
    await expect(response.text()).resolves.toContain("# propgate");
  });

  it("serves HTML with Accept in Vary so a CDN cannot mix the two", async () => {
    const response = await handleRequest(
      new Request("https://propgate.dev/", {
        headers: { Accept: "text/html" },
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("vary")?.toLowerCase()).toContain("accept");
  });

  it("404s in markdown, pointing at the sitemap", async () => {
    const response = await handleRequest(
      new Request("https://propgate.dev/some-path-that-does-not-exist", {
        headers: { Accept: "text/markdown" },
      }),
      env
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(MARKDOWN_CONTENT_TYPE);
    await expect(response.text()).resolves.toBe(NOT_FOUND_MARKDOWN);
  });

  it("does not negotiate JSON, CSS, or other assets", async () => {
    const response = await handleRequest(
      new Request("https://propgate.dev/openapi.json", {
        headers: { Accept: "text/markdown" },
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
