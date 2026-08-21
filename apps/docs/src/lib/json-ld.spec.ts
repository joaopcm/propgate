import { describe, expect, it } from "vitest";
import { homepageJsonLd } from "./json-ld";
import { CONTACT_EMAIL, PRODUCT_NAME } from "./site";

describe("homepageJsonLd", () => {
  const graph = homepageJsonLd()["@graph"] as Record<string, unknown>[];

  it("describes the product and the organisation", () => {
    const types = graph.map((node) => node["@type"]);

    expect(types).toContain("SoftwareApplication");
    expect(types).toContain("Organization");
    expect(types).toContain("WebSite");
  });

  it("names propgate and includes a contactPoint", () => {
    const org = graph.find((node) => node["@type"] === "Organization");

    expect(org).toBeDefined();

    const contact = org?.contactPoint as {
      email?: string;
      contactType?: string;
    };

    expect(org?.name).toBe(PRODUCT_NAME);
    expect(contact.email).toBe(CONTACT_EMAIL);
    expect(contact.contactType).toBe("customer support");
  });
});
