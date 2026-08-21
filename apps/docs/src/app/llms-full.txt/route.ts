import { buildLlmsFullTxt } from "@/lib/llms";

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(buildLlmsFullTxt(), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
