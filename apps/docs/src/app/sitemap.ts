import type { MetadataRoute } from "next";
import { flattenNavigation } from "@/lib/navigation";
import { allEntries } from "@/lib/taxonomy";

const DOCS = "https://docs.propgate.dev";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const pages = flattenNavigation().map((entry, index) => ({
    changeFrequency: "weekly" as const,
    lastModified,
    priority: index === 0 ? 1 : 0.7,
    url: entry.href === "/" ? DOCS : `${DOCS}${entry.href}`,
  }));
  const taxonomy = allEntries().map((entry) => ({
    changeFrequency: "monthly" as const,
    lastModified,
    priority: 0.4,
    url: `${DOCS}/taxonomy/${entry.definition.slug}`,
  }));

  return [...pages, ...taxonomy];
}
