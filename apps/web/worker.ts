import {
  MARKDOWN_CONTENT_TYPE,
  markdownAssetPath,
  negotiate,
  VARY_ACCEPT,
} from "./src/lib/negotiate";
import { NOT_FOUND_MARKDOWN } from "./src/lib/site";

export interface Env {
  ASSETS: { fetch: (input: Request | URL) => Promise<Response> };
}

const ACCEPT_TOKEN = /\baccept\b/i;
const STATIC_ASSET =
  /\.(?:js|css|woff2?|svg|png|jpe?g|gif|json|xml|txt|ico|map)$/i;

function markdownResponse(body: string, status: number): Response {
  return new Response(body, {
    headers: {
      "Content-Type": MARKDOWN_CONTENT_TYPE,
      Vary: VARY_ACCEPT,
    },
    status,
  });
}

function withVary(response: Response): Response {
  const headers = new Headers(response.headers);
  const contentType = headers.get("content-type") ?? "";

  if (!contentType.includes("text/html")) {
    return response;
  }

  const existing = headers.get("Vary");
  if (existing === null || existing === "") {
    headers.set("Vary", VARY_ACCEPT);
  } else if (!ACCEPT_TOKEN.test(existing)) {
    headers.set("Vary", `${existing}, Accept`);
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function skipNegotiation(pathname: string): boolean {
  if (pathname.startsWith("/_next/")) {
    return true;
  }

  return STATIC_ASSET.test(pathname);
}

export async function handleRequest(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const accept = request.headers.get("Accept");
  const wantsMarkdown =
    pathname.endsWith(".md") ||
    (!skipNegotiation(pathname) && negotiate(accept) === "markdown");

  if (wantsMarkdown) {
    const assetUrl = new URL(markdownAssetPath(pathname), url.origin);
    const asset = await env.ASSETS.fetch(assetUrl);

    if (asset.ok) {
      return markdownResponse(await asset.text(), 200);
    }

    return markdownResponse(NOT_FOUND_MARKDOWN, 404);
  }

  return withVary(await env.ASSETS.fetch(request));
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
