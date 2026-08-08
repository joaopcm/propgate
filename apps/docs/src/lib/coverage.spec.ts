import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "./api";
import { flattenNavigation } from "./navigation";

/**
 * The registry against the pages.
 *
 * `api.spec.ts` keeps `ENDPOINTS` honest against `@propgate/dns` in one
 * direction. Nothing checked the other: that each endpoint is *documented*
 * somewhere. Before this, adding a route meant remembering to write a page, and
 * forgetting looked exactly like a route that did not exist.
 *
 * `navigation.spec.ts` covers the inverse failure — a sidebar link with no page
 * behind it. Between them, neither half of the pairing can drift alone.
 */

const APP = join(process.cwd(), "src/app/(docs)");

function bodyOf(href: string): string {
  const relative = href === "/" ? "" : href;

  for (const name of ["page.mdx", "page.tsx"]) {
    try {
      return readFileSync(join(APP, relative, name), "utf8");
    } catch {
      // Try the other extension before giving up.
    }
  }

  throw new Error(`no page for ${href}`);
}

const ALL_PAGES = flattenNavigation()
  .map((entry) => bodyOf(entry.href))
  .join("\n");

describe("api reference coverage", () => {
  it("documents every endpoint the API implements", () => {
    /**
     * Matched on the path string, which every endpoint page carries in its
     * `EndpointHeader`. Coarse deliberately: a stricter match would fail on
     * formatting rather than on a page actually being missing, and a guard that
     * fires on formatting is one somebody deletes.
     */
    const undocumented = ENDPOINTS.filter(
      (endpoint) => !ALL_PAGES.includes(endpoint.path)
    ).map((endpoint) => `${endpoint.method} ${endpoint.path}`);

    expect(undocumented).toEqual([]);
  });

  it("leaves no section of the sidebar empty", () => {
    // An empty section is legal while the docs are being written and a defect
    // once they are: `DocsSidebar` skips it, so the heading silently vanishes
    // and a whole area of the product becomes unreachable from the nav.
    const sections = new Set(flattenNavigation().map((entry) => entry.section));

    expect([...sections].toSorted()).toEqual([
      "@propgate/dns",
      "API reference",
      "CLI",
      "Concepts",
      "Get started",
      "Reference",
      "SDK",
    ]);
  });
});
