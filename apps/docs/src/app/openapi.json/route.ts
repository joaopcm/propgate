import { buildOpenApi } from "@/lib/openapi";

export const dynamic = "force-static";

export function GET(): Response {
  return Response.json(buildOpenApi());
}
