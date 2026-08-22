import { describe, expect, it } from "vitest";
import { highlight, SHIKI_THEME } from "@/lib/shiki";

describe("highlight", () => {
  it("emits token spans rather than plain text", async () => {
    const html = await highlight('curl -X POST "$URL"', "bash");

    expect(html).toContain("<pre");
    expect(html).toContain("<span");
    expect(html).toContain("style=");
  });

  it("uses the theme the MDX pipeline is configured with", () => {
    expect(SHIKI_THEME).toBe("github-dark-dimmed");
  });

  it("highlights each language it is given differently", async () => {
    const asJson = await highlight('{"domain":"example.com"}', "json");
    const asBash = await highlight('{"domain":"example.com"}', "bash");

    expect(asJson).not.toBe(asBash);
  });
});
