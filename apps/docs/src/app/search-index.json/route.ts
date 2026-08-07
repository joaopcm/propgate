import { buildSearchIndex } from "@/lib/search-index";

/**
 * The search index, as a file.
 *
 * `output: "export"` prerenders a GET handler to a static asset, so this runs
 * once at build and lands at `out/search-index.json` — no server, which is the
 * whole reason the docs deploy is plain assets on a CDN.
 *
 * A separate file rather than props on the layout: the index is inert on every
 * page until somebody types, and inlining it would write the same payload into
 * all ~110 exported HTML files. Fetched on first focus, it costs nothing until
 * it is wanted and is cached for the rest of the visit.
 */

export const dynamic = "force-static";

export function GET(): Response {
  return Response.json(buildSearchIndex());
}
