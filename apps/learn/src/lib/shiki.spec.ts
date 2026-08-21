import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHIKI_THEME } from "./shiki";

describe("the Shiki theme", () => {
  it("matches the one next.config.ts gives the rehype plugin", () => {
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");

    expect(config).toContain(`theme: "${SHIKI_THEME}"`);
  });
});
