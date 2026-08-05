import { describe, expect, it } from "vitest";
import { flattenNavigation } from "./navigation";
import { pagerFor } from "./pager";

/**
 * Prev/next, derived from the same array the sidebar renders.
 *
 * Deriving rather than hand-listing is the point: the reading order the sidebar
 * implies and the order these links follow cannot disagree, and a page inserted
 * into `navigation` is wired into the pager by that fact alone.
 */

describe("pagerFor", () => {
  it("has no previous on the first page", () => {
    const [first] = flattenNavigation();
    const pager = pagerFor(String(first?.href));

    expect(pager.previous).toBeUndefined();
    expect(pager.next).toBeDefined();
  });

  it("has no next on the last page", () => {
    const entries = flattenNavigation();
    const last = entries.at(-1);
    const pager = pagerFor(String(last?.href));

    expect(pager.next).toBeUndefined();
    expect(pager.previous).toBeDefined();
  });

  it("gives both neighbours in the middle", () => {
    const entries = flattenNavigation();

    // Skipped rather than asserted when the navigation is still short: this task
    // runs before the content tasks fill the sections in.
    if (entries.length < 3) {
      return;
    }

    const [, middle] = entries;
    const pager = pagerFor(String(middle?.href));

    expect(pager.previous?.href).toBe(entries[0]?.href);
    expect(pager.next?.href).toBe(entries[2]?.href);
  });

  it("gives neither for a page outside the navigation", () => {
    // The taxonomy's 74 slug pages are real pages with no sidebar entry, so this
    // is the common case rather than an error case.
    const pager = pagerFor("/taxonomy/spf-lookup-limit-near");

    expect(pager.previous).toBeUndefined();
    expect(pager.next).toBeUndefined();
  });
});
