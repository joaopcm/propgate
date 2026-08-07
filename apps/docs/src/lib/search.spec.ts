import { describe, expect, it } from "vitest";
import { moveActive, type SearchRecord, search } from "./search";
import { buildSearchIndex } from "./search-index";

/**
 * Ranking, against the real corpus and against a made-up one.
 *
 * The mechanics — AND matching, the cap, deduplication — are asserted on a
 * handful of literal records, because a test that has to be reread whenever
 * somebody edits a page is a test that gets deleted. The three queries that
 * matter are asserted against the real index instead: what a query *returns*
 * is a property of the writing as much as of the weights, and a search that
 * ranks the wrong page first is not something a synthetic fixture can catch.
 */

const index = buildSearchIndex();

const LEADING_ELLIPSIS = /^…/;

function record(over: Partial<SearchRecord>): SearchRecord {
  return {
    href: "/somewhere",
    section: "Concepts",
    text: "",
    title: "Something",
    ...over,
  };
}

function topHref(query: string): string | undefined {
  return search(index, query).map((result) => result.href)[0];
}

describe("search over the published docs", () => {
  it("ranks the monitoring page first for hysteresis", () => {
    expect(topHref("hysteresis")).toContain("/concepts/monitoring");
  });

  it("deep-links to the section rather than the top of the page", () => {
    expect(topHref("hysteresis")).toContain("#");
  });

  it("finds a diagnosis code pasted in verbatim", () => {
    expect(topHref("SPF_LOOKUP_LIMIT_EXCEEDED")).toBe(
      "/taxonomy/spf-lookup-limit-exceeded"
    );
  });

  it("finds the same code typed as words", () => {
    expect(topHref("spf lookup limit exceeded")).toBe(
      "/taxonomy/spf-lookup-limit-exceeded"
    );
  });

  it("ranks the rotate endpoint first for a two-word query", () => {
    expect(topHref("rotate secret")).toContain("/api/webhooks/rotate-secret");
  });

  it("returns nothing for a query nothing answers", () => {
    expect(search(index, "kubernetes")).toEqual([]);
  });
});

describe("search mechanics", () => {
  const corpus: SearchRecord[] = [
    record({ href: "/a", text: "spf and dkim", title: "Alpha" }),
    record({ href: "/b", text: "dkim only", title: "Beta" }),
  ];

  it("returns nothing for an empty query", () => {
    expect(search(corpus, "")).toEqual([]);
  });

  it("returns nothing for a query that is only whitespace", () => {
    expect(search(corpus, "   ")).toEqual([]);
  });

  it("drops a record that matches only some of the tokens", () => {
    const hrefs = search(corpus, "spf dkim").map((result) => result.href);

    expect(hrefs).toEqual(["/a"]);
  });

  it("ranks a title hit above a body hit", () => {
    const hrefs = search(
      [
        record({ href: "/body", text: "beta appears in the prose here" }),
        record({ href: "/title", title: "Beta" }),
      ],
      "beta"
    ).map((result) => result.href);

    expect(hrefs).toEqual(["/title", "/body"]);
  });

  it("ranks an exact title above a title that merely contains the token", () => {
    const hrefs = search(
      [
        record({ href: "/contains", title: "About beta and its friends" }),
        record({ href: "/exact", title: "beta" }),
      ],
      "beta"
    ).map((result) => result.href);

    expect(hrefs).toEqual(["/exact", "/contains"]);
  });

  it("breaks ties on navigation order", () => {
    const hrefs = search(
      [
        record({ href: "/first", title: "beta" }),
        record({ href: "/second", title: "beta" }),
      ],
      "beta"
    ).map((result) => result.href);

    expect(hrefs).toEqual(["/first", "/second"]);
  });

  it("collapses records that share a destination", () => {
    const results = search(
      [
        record({ hash: "#events", href: "/webhooks", title: "domain.failed" }),
        record({
          hash: "#events",
          href: "/webhooks",
          title: "domain.verified",
        }),
      ],
      "domain"
    );

    expect(results).toHaveLength(1);
  });

  it("caps the menu at eight", () => {
    const many = Array.from({ length: 20 }, (_, position) =>
      record({ href: `/page-${position}`, title: "beta" })
    );

    expect(search(many, "beta")).toHaveLength(8);
  });

  it("windows the snippet around the match rather than starting at the top", () => {
    const long = `${"filler ".repeat(60)}needle ${"filler ".repeat(60)}`;
    const snippets = search(
      [record({ href: "/long", text: long })],
      "needle"
    ).map((result) => result.snippet);

    expect(snippets[0]).toContain("needle");
    expect(snippets[0]).toMatch(LEADING_ELLIPSIS);
  });
});

describe("moveActive", () => {
  it("steps down through the list", () => {
    expect(moveActive(0, 1, 5)).toBe(1);
  });

  it("steps up through the list", () => {
    expect(moveActive(3, -1, 5)).toBe(2);
  });

  it("stops at the last row rather than running off the end", () => {
    expect(moveActive(4, 1, 5)).toBe(4);
  });

  it("stops at the first row rather than going negative", () => {
    expect(moveActive(0, -1, 5)).toBe(0);
  });

  /**
   * The regression. ArrowDown pressed while the index was still being fetched
   * stored -1, and the menu then arrived with nothing highlighted,
   * `aria-activedescendant` naming an element that does not exist, and Enter
   * doing nothing until the reader happened to press a key that healed it.
   */
  it("stays at zero when there is nothing to move through yet", () => {
    expect(moveActive(0, 1, 0)).toBe(0);
    expect(moveActive(0, -1, 0)).toBe(0);
  });
});
