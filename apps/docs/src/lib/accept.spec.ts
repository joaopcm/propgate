import { describe, expect, it } from "vitest";
import {
  negotiateType,
  parseAccept,
  prefersJson,
  prefersMarkdown,
} from "./accept";

describe("parseAccept", () => {
  it("orders by q-value, then specificity", () => {
    const ranges = parseAccept(
      "text/html, text/markdown;q=0.9, application/json;q=0.1, */*;q=0.01"
    );

    expect(ranges.map((range) => range.type)).toEqual([
      "text/html",
      "text/markdown",
      "application/json",
      "*/*",
    ]);
  });

  it("drops q=0 ranges", () => {
    expect(parseAccept("text/markdown;q=0").length).toBe(0);
  });
});

describe("negotiateType", () => {
  it("treats a missing header as HTML", () => {
    expect(negotiateType(null)).toBe("html");
  });

  it("picks markdown when it is the first preference", () => {
    expect(negotiateType("text/markdown")).toBe("markdown");
    expect(negotiateType("text/markdown, text/html;q=0.8, */*;q=0.1")).toBe(
      "markdown"
    );
  });

  it("picks HTML when it outranks markdown", () => {
    expect(negotiateType("text/html, text/markdown;q=0.9")).toBe("html");
  });

  it("does not treat a Chrome header as a markdown request", () => {
    expect(
      negotiateType(
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      )
    ).toBe("html");
  });
});

describe("prefersMarkdown", () => {
  it("is true only when markdown wins", () => {
    expect(prefersMarkdown("text/markdown")).toBe(true);
    expect(prefersMarkdown("text/html")).toBe(false);
    expect(prefersMarkdown(null)).toBe(false);
  });
});

describe("a wildcard expresses no preference", () => {
  it("treats a bare */* as HTML rather than the head of the offered list", () => {
    expect(negotiateType("*/*")).toBe("html");
    expect(prefersMarkdown("*/*")).toBe(false);
  });

  it("serves HTML for a Chrome stylesheet request", () => {
    expect(prefersMarkdown("text/css,*/*;q=0.1")).toBe(false);
  });

  it("serves HTML for a Chrome script request", () => {
    expect(prefersMarkdown("*/*")).toBe(false);
  });

  it("serves HTML for a Chrome font request", () => {
    expect(prefersMarkdown("font/woff2,*/*;q=0.1")).toBe(false);
  });

  it("serves HTML for a Chrome image request", () => {
    expect(prefersMarkdown("image/avif,image/webp,image/apng,*/*;q=0.8")).toBe(
      false
    );
  });

  it("treats text/* as no preference too", () => {
    expect(prefersMarkdown("text/*")).toBe(false);
  });

  it("still serves markdown when it is named explicitly", () => {
    expect(prefersMarkdown("text/markdown")).toBe(true);
    expect(prefersMarkdown("text/markdown,text/html;q=0.5")).toBe(true);
    expect(prefersMarkdown("text/markdown;q=0.9,*/*;q=0.1")).toBe(true);
  });

  it("still prefers HTML when it outranks an explicit markdown", () => {
    expect(prefersMarkdown("text/html,text/markdown;q=0.5")).toBe(false);
  });

  it("does not treat a wildcard as a JSON request", () => {
    expect(prefersJson("*/*")).toBe(false);
    expect(prefersJson("application/json")).toBe(true);
  });
});
