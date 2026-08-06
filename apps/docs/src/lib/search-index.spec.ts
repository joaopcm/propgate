import { existsSync } from "node:fs";
import { join } from "node:path";
import { DIAGNOSIS_REGISTRY } from "@propgate/dns";
import { describe, expect, it } from "vitest";
import { flattenNavigation } from "./navigation";
import { buildSearchIndex } from "./search-index";

/**
 * The index against the site it claims to describe.
 *
 * The realistic failure here is not a crash. It is the extractor leaking an
 * `import` line or a JSX tag into `text`, which nobody sees: the build passes,
 * the menu opens, and the results are quietly worse than they should be. Every
 * assertion below is aimed at that shape of defect rather than at the happy
 * path.
 */

const index = buildSearchIndex();

const LEAKED_SYNTAX = /^import |<[A-Z]|```|\{/;
const URL_SAFE_HASH = /^#[a-z0-9-]+$/;
const PAGES_DIR = join(process.cwd(), "src/app/(docs)");

/**
 * Records that came out of a `page.mdx`, which is the only place the extractor
 * runs. The registry-fed pages are exempt from the leak check below on purpose:
 * RFC 7208's own prose contains `%{p}`, and failing that is the test being
 * wrong rather than the index being broken.
 */
function fromMdx(href: string): boolean {
  return existsSync(join(PAGES_DIR, href === "/" ? "" : href, "page.mdx"));
}

describe("buildSearchIndex", () => {
  it("covers every page in the sidebar", () => {
    const covered = new Set(index.map((record) => record.href));
    const missing = flattenNavigation()
      .map((entry) => entry.href)
      .filter((href) => !covered.has(href));

    expect(missing).toEqual([]);
  });

  it("gives every diagnosis code a record titled with the code", () => {
    const byTitle = new Map(index.map((record) => [record.title, record]));
    const missing = Object.values(DIAGNOSIS_REGISTRY)
      .map((definition) => definition.code)
      .filter((code) => !byTitle.has(code));

    expect(missing).toEqual([]);
  });

  it("points each code record at its own page", () => {
    const spf = index.find(
      (record) => record.title === "SPF_LOOKUP_LIMIT_EXCEEDED"
    );

    expect(spf?.href).toBe("/taxonomy/spf-lookup-limit-exceeded");
    expect(spf?.text).not.toBe("");
  });

  it("leaks no imports, tags, fences or expressions out of the mdx", () => {
    const leaking = index
      .filter((record) => fromMdx(record.href))
      .filter((record) => LEAKED_SYNTAX.test(record.text))
      .map((record) => `${record.href}: ${record.text.slice(0, 80)}`);

    expect(leaking).toEqual([]);
  });

  it("never emits a record with nothing to match against", () => {
    const empty = index
      .filter((record) => record.text.trim() === "")
      .map((record) => `${record.href}${record.hash ?? ""}`);

    expect(empty).toEqual([]);
  });

  it("gives every section record a url-safe hash", () => {
    const bad = index
      .filter((record) => record.heading !== undefined)
      .filter((record) => !URL_SAFE_HASH.test(record.hash ?? ""))
      .map((record) => `${record.href} — ${record.hash}`);

    expect(bad).toEqual([]);
  });

  it("carries no hash for the text above a page's first heading", () => {
    const intro = index.find(
      (record) =>
        record.href === "/concepts/monitoring" && record.heading === undefined
    );

    expect(intro?.hash).toBeUndefined();
  });

  it("reads the h1 as the page title rather than the sidebar label", () => {
    const record = index.find(
      (entry) => entry.href === "/api/webhooks/rotate-secret"
    );

    // The sidebar calls this one "Rotate secret", for width.
    expect(record?.title).toBe("Rotate a webhook secret");
  });

  it("splits a long page into more than one section", () => {
    const monitoring = index.filter(
      (record) => record.href === "/concepts/monitoring"
    );

    expect(monitoring.length).toBeGreaterThan(3);
  });

  it("keeps the method and path an endpoint page prints largest", () => {
    const list = index
      .filter((record) => record.href === "/api/domains/list")
      .map((record) => record.text)
      .join(" ");

    expect(list).toContain("GET");
    expect(list).toContain("/v1/domains");
    expect(list).toContain("propgate domains list");
  });

  it("keeps callout prose, which is text a reader reads", () => {
    const monitoring = index
      .filter((record) => record.href === "/concepts/monitoring")
      .map((record) => record.text)
      .join(" ");

    expect(monitoring).toContain("once per episode");
  });
});
