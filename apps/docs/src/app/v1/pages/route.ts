import { docsCatalog } from "@/lib/catalog";

export const dynamic = "force-static";

export function GET(): Response {
  return Response.json({ data: docsCatalog(), error: null, meta: null });
}
