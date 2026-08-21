import type { MetadataRoute } from "next";
import { INDEXABLE_PATHS, SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return INDEXABLE_PATHS.map((path, index) => ({
    changeFrequency: "weekly" as const,
    lastModified,
    priority: index === 0 ? 1 : 0.6,
    url: path === "/" ? SITE_URL : `${SITE_URL}${path}`,
  }));
}
