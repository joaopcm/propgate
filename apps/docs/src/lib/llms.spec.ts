import { describe, expect, it } from "vitest";
import { buildLlmsTxt } from "./llms";
import { flattenNavigation } from "./navigation";

describe("llms.txt", () => {
  it("lists every sidebar page and says when to use propgate", () => {
    const body = buildLlmsTxt();

    expect(body.startsWith("# propgate docs")).toBe(true);
    expect(body).toContain("## When to use this");
    expect(body).toContain("npx @propgate/cli");
    expect(body).toContain("@propgate/sdk");
    expect(body).toContain("/openapi.json");
    expect(body).toContain("/authentication");
    expect(body).toContain("/webhooks");

    for (const entry of flattenNavigation()) {
      const url =
        entry.href === "/"
          ? "https://docs.propgate.dev"
          : `https://docs.propgate.dev${entry.href}`;

      expect(body, entry.href).toContain(url);
    }
  });
});
