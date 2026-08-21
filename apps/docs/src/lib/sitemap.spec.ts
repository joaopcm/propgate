import { describe, expect, it } from "vitest";
import { flattenNavigation } from "./navigation";
import { sitemapEntries, sitemapXml } from "./sitemap";

describe("sitemap", () => {
  const now = new Date("2026-08-21T00:00:00.000Z");
  const entries = sitemapEntries(now);

  it("lists every sidebar page and the trust pages", () => {
    const locs = new Set(entries.map((entry) => entry.loc));

    for (const entry of flattenNavigation()) {
      const loc =
        entry.href === "/"
          ? "https://docs.propgate.dev/"
          : `https://docs.propgate.dev${entry.href}`;

      expect(locs.has(loc), loc).toBe(true);
    }

    expect(locs.has("https://docs.propgate.dev/about")).toBe(true);
    expect(locs.has("https://docs.propgate.dev/contact")).toBe(true);
    expect(locs.has("https://docs.propgate.dev/privacy")).toBe(true);
  });

  it("emits lastmod and stays well under 50MB", () => {
    const xml = sitemapXml(now);

    expect(xml).toContain("<lastmod>2026-08-21T00:00:00.000Z</lastmod>");
    expect(xml).toContain("http://www.sitemaps.org/schemas/sitemap/0.9");
    expect(Buffer.byteLength(xml)).toBeLessThan(50 * 1024 * 1024);
  });
});
