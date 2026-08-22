import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "./api";
import { flattenNavigation } from "./navigation";

const APP = join(process.cwd(), "src/app/(docs)");

function bodyOf(href: string): string {
  const relative = href === "/" ? "" : href;

  for (const name of ["page.mdx", "page.tsx"]) {
    try {
      return readFileSync(join(APP, relative, name), "utf8");
    } catch {
      // try the other filename
    }
  }

  throw new Error(`no page for ${href}`);
}

const ALL_PAGES = flattenNavigation()
  .map((entry) => bodyOf(entry.href))
  .join("\n");

describe("api reference coverage", () => {
  it("documents every endpoint the API implements", () => {
    const undocumented = ENDPOINTS.filter(
      (endpoint) => !ALL_PAGES.includes(endpoint.path)
    ).map((endpoint) => `${endpoint.method} ${endpoint.path}`);

    expect(undocumented).toEqual([]);
  });

  it("leaves no section of the sidebar empty", () => {
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
