import { describe, expect, it } from "vitest";
import { docsCatalog, docsStatus } from "./catalog";

describe("docs catalog", () => {
  it("names propgate and points at markdown URLs", () => {
    const catalog = docsCatalog();

    expect(catalog.name).toBe("propgate docs");
    expect(catalog.pages.some((page) => page.href === "/developers")).toBe(
      true
    );
    expect(
      catalog.pages.find((page) => page.href === "/quickstart")?.markdownUrl
    ).toBe("https://docs.propgate.dev/quickstart.md");
  });
});

describe("docsStatus", () => {
  it("points at the public API and the spec", () => {
    const status = docsStatus();

    expect(status.status).toBe("ok");
    expect(status.api).toBe("https://api.propgate.dev");
    expect(status.openapi).toBe("https://docs.propgate.dev/openapi.json");
  });
});
