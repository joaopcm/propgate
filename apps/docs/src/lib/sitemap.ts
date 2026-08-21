import { listMarkdownPages } from "./markdown-pages";
import { SITE_URL } from "./site";

export interface SitemapUrl {
  readonly lastmod: string;
  readonly loc: string;
}

/**
 * Indexable HTML URLs, with lastmod.
 *
 * Built from the same catalog as the markdown surface so a page that exists
 * for agents also exists for crawlers. lastmod is the build date: these pages
 * are prerendered, and a per-file mtime would change with every checkout.
 */

export function sitemapEntries(now = new Date()): readonly SitemapUrl[] {
  const lastmod = now.toISOString();
  const pages = listMarkdownPages().map((page) => ({
    lastmod,
    loc: `${SITE_URL}${page.href === "/" ? "/" : page.href}`,
  }));

  return pages;
}

export function sitemapXml(now = new Date()): string {
  const urls = sitemapEntries(now)
    .map(
      (entry) =>
        `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>\n    <lastmod>${entry.lastmod}</lastmod>\n  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
