import { buildSearchIndex } from "@/lib/search-index";

export const dynamic = "force-static";

export function GET(): Response {
  return Response.json(buildSearchIndex());
}
