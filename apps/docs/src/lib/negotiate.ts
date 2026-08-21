import { prefersJson, prefersMarkdown } from "./accept";
import { jsonErrorResponse } from "./json-error";
import { markdownPathFor } from "./markdown-paths";
import { notFoundMarkdown } from "./not-found-markdown";

/**
 * Request-time behaviour the static export cannot do.
 *
 * Pages are files. Accept negotiation, a markdown 404 body, and JSON errors
 * for unknown `/v1/*` paths need the Worker in front of those files. This
 * module is the whole decision; `worker.ts` is the Cloudflare adapter.
 */

export const VARY_ACCEPT = "Accept, Accept-Encoding";

const TRAILING_SLASH = /\/$/;

const MARKDOWN_TYPE = "text/markdown; charset=utf-8";

/**
 * Paths the Worker must hand straight to the assets, without negotiating.
 *
 * The second half of the CSS failure, and the half that makes the class of bug
 * impossible rather than merely fixed. Even with wildcard handling corrected, a
 * client that genuinely sent `Accept: text/markdown` for a stylesheet would be
 * answered with a markdown 404 — because the negotiation below would look for
 * `/_next/static/chunks/0a-6hmdrq391z.css.md`, which does not and should never
 * exist.
 *
 * Negotiation is about *pages*. A page has a markdown twin; an asset does not.
 * Anything under `/_next/` is a build artefact, and anything whose last segment
 * carries an extension is a file being asked for by name — neither is a
 * document with alternative representations.
 *
 * `.md` is the exception: those are the markdown twins themselves, and asking
 * for one by name has to keep working.
 */
export function isAssetPath(pathname: string): boolean {
  if (pathname.startsWith("/_next/")) {
    return true;
  }

  const last = pathname.slice(pathname.lastIndexOf("/") + 1);

  return last.includes(".") && !last.endsWith(".md");
}

export function isCatalogPath(pathname: string): boolean {
  return (
    pathname === "/openapi.json" ||
    pathname === "/v1/status" ||
    pathname === "/v1/pages" ||
    pathname.startsWith("/v1/")
  );
}

export function markdownAssetPath(pathname: string): string {
  const clean = pathname === "/" ? "/" : pathname.replace(TRAILING_SLASH, "");

  return markdownPathFor(clean);
}

function withVary(response: Response, contentType?: string): Response {
  const headers = new Headers(response.headers);

  headers.set("Vary", VARY_ACCEPT);

  if (contentType !== undefined) {
    headers.set("Content-Type", contentType);
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export function markdownResponse(body: string, status = 200): Response {
  return new Response(body, {
    headers: {
      "Content-Type": MARKDOWN_TYPE,
      Vary: VARY_ACCEPT,
    },
    status,
  });
}

export async function handleDocsRequest(
  request: Request,
  fetchAsset: (request: Request) => Promise<Response> | Response
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const accept = request.headers.get("Accept");

  if (isCatalogPath(pathname)) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonErrorResponse(
        405,
        "method_not_allowed",
        `${request.method} is not allowed on ${pathname}`,
        { Allow: "GET, HEAD", Vary: VARY_ACCEPT }
      );
    }

    const asset = await fetchAsset(request);

    if (asset.status === 404) {
      return jsonErrorResponse(
        404,
        "not_found",
        `${pathname} is not a propgate docs API path`
      );
    }

    return withVary(asset, "application/json; charset=utf-8");
  }

  // Assets are served as themselves. See `isAssetPath`.
  if (isAssetPath(pathname)) {
    return await fetchAsset(request);
  }

  if (prefersMarkdown(accept)) {
    const mdUrl = new URL(markdownAssetPath(pathname), url.origin);
    const md = await fetchAsset(new Request(mdUrl, { method: "GET" }));

    if (md.ok) {
      return withVary(md, MARKDOWN_TYPE);
    }

    return markdownResponse(notFoundMarkdown(pathname), 404);
  }

  const asset = await fetchAsset(request);

  if (asset.status === 404 && prefersJson(accept)) {
    return jsonErrorResponse(
      404,
      "not_found",
      `${pathname} is not a page on propgate docs`
    );
  }

  return withVary(asset);
}
