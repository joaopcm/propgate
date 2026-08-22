import { describe, expect, it } from "vitest";
import { flattenNavigation } from "./navigation";
import { pagerFor } from "./pager";

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

    if (entries.length < 3) {
      return;
    }

    const [, middle] = entries;
    const pager = pagerFor(String(middle?.href));

    expect(pager.previous?.href).toBe(entries[0]?.href);
    expect(pager.next?.href).toBe(entries[2]?.href);
  });

  it("gives neither for a page outside the navigation", () => {
    const pager = pagerFor("/taxonomy/spf-lookup-limit-near");

    expect(pager.previous).toBeUndefined();
    expect(pager.next).toBeUndefined();
  });
});
