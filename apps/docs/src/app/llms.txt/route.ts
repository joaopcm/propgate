import { buildLlmsTxt } from "@/lib/llms";

/**
 * The agent index, as a file.
 *
 * Same trick as `search-index.json`: `output: "export"` prerenders a GET
 * handler to a static asset, so this runs once at build and lands at
 * `out/llms.txt`.
 */

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(buildLlmsTxt(), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
