import { describe, expect, it } from "vitest";
import { markdownAssetPath, negotiate } from "./negotiate";

describe("negotiate", () => {
  it("serves HTML when Accept is missing, which is what curl does", () => {
    expect(negotiate(null)).toBe("html");
    expect(negotiate("")).toBe("html");
  });

  it("serves markdown when that is what was asked for", () => {
    expect(negotiate("text/markdown")).toBe("markdown");
    expect(negotiate("text/markdown; charset=utf-8")).toBe("markdown");
    expect(negotiate("text/markdown, text/html;q=0.9")).toBe("markdown");
  });

  it("prefers HTML on a q-value tie, matching a browser that lists both", () => {
    expect(negotiate("text/html, text/markdown")).toBe("html");
    expect(
      negotiate(
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      )
    ).toBe("html");
  });

  it("respects q=0", () => {
    expect(negotiate("text/markdown;q=0, text/html")).toBe("html");
  });
});

describe("markdownAssetPath", () => {
  it("maps the HTML URL onto the sibling .md asset", () => {
    expect(markdownAssetPath("/")).toBe("/index.md");
    expect(markdownAssetPath("/about")).toBe("/about.md");
    expect(markdownAssetPath("/about/")).toBe("/about.md");
    expect(markdownAssetPath("/about.md")).toBe("/about.md");
    expect(markdownAssetPath("/privacy")).toBe("/privacy.md");
  });
});
