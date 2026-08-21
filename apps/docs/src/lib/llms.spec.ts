import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLlmsFullTxt, buildLlmsTxt } from "./llms";
import { htmlPathHasPage } from "./markdown-pages";
import { flattenNavigation } from "./navigation";

const APP = join(process.cwd(), "src/app/(docs)");

function isMdx(href: string): boolean {
  const relative = href === "/" ? "" : href;

  return existsSync(join(APP, relative, "page.mdx"));
}

describe("buildLlmsTxt", () => {
  const body = buildLlmsTxt();

  it("follows the llms.txt shape", () => {
    expect(body.startsWith("# propgate\n")).toBe(true);
    expect(body).toContain("\n> ");
    expect(body).toContain("## When to use this");
  });

  it("lists every navigation href that has a page", () => {
    const missing = flattenNavigation()
      .filter((entry) => htmlPathHasPage(entry.href))
      .filter(
        (entry) =>
          !body.includes(`${entry.href === "/" ? "/index" : entry.href}.md`)
      );

    expect(missing.map((entry) => entry.href)).toEqual([]);
  });

  it("names the developer resources by product", () => {
    expect(body).toContain("openapi.json");
    expect(body).toContain("/developers");
    expect(body).toContain("propgate developer portal");
    expect(body).toContain("api.propgate.dev/v1/checks");
  });

  it("says when to call and that there is no MCP server", () => {
    expect(body).toContain("Use propgate when");
    expect(body).toContain("There is no MCP server");
  });
});

describe("buildLlmsFullTxt", () => {
  it("includes page sources and skips nothing the sidebar promised as MDX", () => {
    const body = buildLlmsFullTxt();
    const skippedTsx = flattenNavigation().filter(
      (entry) => !isMdx(entry.href)
    );

    expect(body).toContain("Source: https://docs.propgate.dev/quickstart");
    expect(skippedTsx.length).toBeGreaterThan(0);
    expect(body).toContain("Diagnosis taxonomy");
  });
});
