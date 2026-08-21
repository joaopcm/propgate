import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Files `next build` must emit. Skipped on a clean checkout: same reason
 * `globals.spec.ts` skips the utility-class half when `out/` is missing.
 */

const OUT = join(process.cwd(), "out");

describe.skipIf(!existsSync(OUT))("emitted agent files", () => {
  it("writes the machine-readable surface", () => {
    for (const name of [
      "404.html",
      "llms.txt",
      "llms-full.txt",
      "openapi.json",
      "sitemap.xml",
      "robots.txt",
      "v1/status",
      "v1/pages",
      "index.md",
      "quickstart.md",
      "developers.html",
      "about.html",
      "contact.html",
      "privacy.html",
    ]) {
      expect(existsSync(join(OUT, name)), name).toBe(true);
    }
  });

  it("puts the four homepage metadata signals in index.html", () => {
    const html = readFileSync(join(OUT, "index.html"), "utf8");

    expect(html).toContain('rel="canonical"');
    expect(html).toContain('lang="en"');
    expect(html).toContain('property="og:type"');
    expect(html).toContain('property="og:image"');
  });

  it("emits a real OpenAPI document and a when-to-use llms.txt", () => {
    const spec = JSON.parse(
      readFileSync(join(OUT, "openapi.json"), "utf8")
    ) as { openapi: string; paths: Record<string, unknown> };
    const llms = readFileSync(join(OUT, "llms.txt"), "utf8");

    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths["/v1/checks"]).toBeDefined();
    expect(llms).toContain("## When to use this");
  });
});
