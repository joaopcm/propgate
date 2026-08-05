import { describe, expect, it } from "vitest";
import { highlight, SHIKI_THEME } from "@/lib/shiki";

/**
 * That highlighting actually happens.
 *
 * The docs shipped for months with a hand-rolled `<Code>` that emitted a bare
 * `<pre>`, while Shiki sat configured and unused in `next.config.ts` — so the
 * failure mode here is not an exception, it is plain text that nobody notices is
 * plain. Asserting on the emitted markup is the only way to see the difference.
 */

describe("highlight", () => {
  it("emits token spans rather than plain text", async () => {
    const html = await highlight('curl -X POST "$URL"', "bash");

    expect(html).toContain("<pre");
    expect(html).toContain("<span");
    // A theme that failed to load renders every token in one colour.
    expect(html).toContain("style=");
  });

  it("uses the theme the MDX pipeline is configured with", () => {
    // Two highlighters run in this app: the rehype plugin for fenced blocks in
    // MDX, and this one for CodeTabs. Different themes would look like a bug.
    expect(SHIKI_THEME).toBe("github-dark-dimmed");
  });

  it("highlights each language it is given differently", async () => {
    const asJson = await highlight('{"domain":"example.com"}', "json");
    const asBash = await highlight('{"domain":"example.com"}', "bash");

    expect(asJson).not.toBe(asBash);
  });
});
