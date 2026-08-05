import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findNavEntry,
  flattenNavigation,
  isGroupedSection,
  navigation,
} from "./navigation";

/**
 * The sidebar against the filesystem.
 *
 * A link in the sidebar that 404s is the worst defect a docs site can have: it
 * is invisible in review, it looks like the product is half-built, and nothing
 * else in the suite can see it. `output: "export"` makes it worse — the build
 * succeeds and the file simply is not there.
 */

const APP = join(process.cwd(), "src/app/(docs)");

function pageExistsFor(href: string): boolean {
  const relative = href === "/" ? "" : href;

  return (
    existsSync(join(APP, relative, "page.mdx")) ||
    existsSync(join(APP, relative, "page.tsx"))
  );
}

describe("navigation", () => {
  it("is not empty", () => {
    expect(navigation.length).toBeGreaterThan(0);
    expect(flattenNavigation().length).toBeGreaterThan(0);
  });

  it("lists every href exactly once", () => {
    const hrefs = flattenNavigation().map((entry) => entry.href);

    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("points every href at a page that exists", () => {
    const missing = flattenNavigation()
      .map((entry) => entry.href)
      .filter((href) => !pageExistsFor(href));

    expect(missing).toEqual([]);
  });

  it("resolves an entry back to its section and group", () => {
    const entry = findNavEntry("/api");

    expect(entry?.section).toBe("API reference");
    expect(entry?.group).toBe("Get started");
  });

  it("has no entry for a page nobody wrote", () => {
    expect(findNavEntry("/nope")).toBeUndefined();
  });

  it("never yields an entry for a section with no items", () => {
    const emptySectionTitles = new Set(
      navigation
        .filter((section) =>
          isGroupedSection(section)
            ? section.groups.every((group) => group.items.length === 0)
            : section.items.length === 0
        )
        .map((section) => section.title)
    );

    const flattenedSections = flattenNavigation().map((entry) => entry.section);

    expect(
      flattenedSections.some((title) => emptySectionTitles.has(title))
    ).toBe(false);
  });
});
