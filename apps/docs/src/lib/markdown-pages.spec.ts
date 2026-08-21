import { describe, expect, it } from "vitest";
import { listMarkdownPages, markdownPathFor } from "./markdown-pages";
import { flattenNavigation } from "./navigation";

describe("listMarkdownPages", () => {
  const pages = listMarkdownPages();

  it("covers every sidebar href", () => {
    const hrefs = new Set(pages.map((page) => page.href));
    const missing = flattenNavigation()
      .map((entry) => entry.href)
      .filter((href) => !hrefs.has(href));

    expect(missing).toEqual([]);
  });

  it("includes trust pages and taxonomy codes", () => {
    const hrefs = new Set(pages.map((page) => page.href));

    expect(hrefs.has("/about")).toBe(true);
    expect(hrefs.has("/contact")).toBe(true);
    expect(hrefs.has("/privacy")).toBe(true);
    expect(pages.some((page) => page.href.startsWith("/taxonomy/"))).toBe(true);
  });

  it("maps / to /index.md", () => {
    expect(markdownPathFor("/")).toBe("/index.md");
    expect(markdownPathFor("/quickstart")).toBe("/quickstart.md");
  });
});
