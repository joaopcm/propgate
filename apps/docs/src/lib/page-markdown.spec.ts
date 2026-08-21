import { describe, expect, it } from "vitest";
import { pageMarkdown } from "./page-markdown";

/**
 * The markdown an agent reads.
 *
 * Imports and the metadata export are machinery. Prose mentioning the word
 * "import" must survive.
 */

const PATH = "src/app/(docs)/quickstart/page.mdx";
const LEADING_BLANK = /^\s*\n/;

describe("pageMarkdown", () => {
  it("keeps the prose and the fenced code", () => {
    const markdown = pageMarkdown(PATH);

    expect(markdown).toContain("# ");
    expect(markdown).toContain("```");
  });

  it("strips the imports", () => {
    for (const line of pageMarkdown(PATH).split("\n")) {
      expect(line.startsWith("import ")).toBe(false);
    }
  });

  it("strips the metadata export", () => {
    expect(pageMarkdown("src/app/(docs)/page.mdx")).not.toContain(
      "export const metadata"
    );
  });

  it("does not start with blank lines", () => {
    expect(pageMarkdown(PATH)).not.toMatch(LEADING_BLANK);
  });
});
