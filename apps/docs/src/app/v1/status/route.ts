import { docsStatus } from "@/lib/catalog";

export const dynamic = "force-static";

export function GET(): Response {
  return Response.json({ data: docsStatus(), error: null, meta: null });
}
