import type { MetadataRoute } from "next";
import { sitemapEntries } from "@/lib/sitemap";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries().map((entry) => ({
    lastModified: entry.lastmod,
    url: entry.loc,
  }));
}
