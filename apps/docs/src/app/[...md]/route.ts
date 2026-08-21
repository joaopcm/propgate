import { notFound } from "next/navigation";
import { listMarkdownPages, markdownPageByHref } from "@/lib/markdown-pages";
import { markdownHrefFromAssetPath } from "@/lib/markdown-paths";

export const dynamic = "force-static";

const LEADING_SLASH = /^\//;

/**
 * `{path}.md` for every HTML page.
 *
 * `generateStaticParams` only emits `*.md` segments, so this does not collide
 * with the HTML pages. The Worker maps `Accept: text/markdown` on `/quickstart`
 * onto `/quickstart.md`.
 */

export function generateStaticParams(): { md: string[] }[] {
  return listMarkdownPages().map((page) => ({
    md: page.markdownPath.replace(LEADING_SLASH, "").split("/"),
  }));
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ md: string[] }> }
): Promise<Response> {
  const { md } = await context.params;
  const href = markdownHrefFromAssetPath(`/${md.join("/")}`);
  const page = href === undefined ? undefined : markdownPageByHref(href);

  if (page === undefined) {
    notFound();
  }

  return new Response(page.markdown, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}
