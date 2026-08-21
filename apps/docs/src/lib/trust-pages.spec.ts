import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { homepageJsonLd } from "./json-ld";
import { pageMarkdown } from "./page-markdown";

const TRUST = ["/about", "/contact", "/privacy"] as const;
const APP = join(process.cwd(), "src/app/(docs)");

describe("trust anchor pages", () => {
  it("has 500+ characters of real content on about, contact, and privacy", () => {
    for (const href of TRUST) {
      const markdown = pageMarkdown(`src/app/(docs)${href}/page.mdx`);

      expect(markdown.length, href).toBeGreaterThanOrEqual(500);
      expect(markdown.toLowerCase()).toContain("propgate");
    }
  });

  it("keeps the homepage metadata signals in source", () => {
    const home = readFileSync(join(APP, "page.mdx"), "utf8");
    const layout = readFileSync(
      join(process.cwd(), "src/app/layout.tsx"),
      "utf8"
    );

    expect(home).toContain("canonical");
    expect(layout).toContain('lang="en"');
    expect(layout).toContain('type: "website"');
    expect(homepageJsonLd()["@graph"]).toBeDefined();
  });
});
