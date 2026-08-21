import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ABOUT_BODY,
  ABOUT_H1,
  CONTACT_BODY,
  CONTACT_H1,
  HOME_FOOTER,
  HOME_H1,
  HOME_LEAD,
  HOME_MARKDOWN,
  INDEXABLE_PATHS,
  jsonLd,
  LLMS_TXT,
  MARKDOWN_FOR_PATH,
  NOT_FOUND_MARKDOWN,
  PRIVACY_BODY,
  PRIVACY_H1,
  SITE_NAME,
  SITE_URL,
} from "./site";

const PUBLIC = join(process.cwd(), "public");
const MIN_CHARS = 500;

function visibleLength(...parts: string[]): number {
  return parts.join(" ").replace(/\s+/g, " ").trim().length;
}

describe("homepage copy", () => {
  it("has an H1 and 500+ characters of text an agent can read without JS", () => {
    expect(HOME_H1.length).toBeGreaterThan(0);
    expect(visibleLength(HOME_H1, HOME_LEAD, HOME_FOOTER)).toBeGreaterThan(
      MIN_CHARS
    );
  });

  it("names propgate in the markdown variant", () => {
    expect(HOME_MARKDOWN.startsWith(`# ${SITE_NAME}`)).toBe(true);
    expect(HOME_MARKDOWN).toContain("/openapi.json");
    expect(HOME_MARKDOWN).toContain("@propgate/cli");
  });
});

describe("trust pages", () => {
  it("gives about, contact and privacy 500+ characters each", () => {
    expect(ABOUT_H1).toContain(SITE_NAME);
    expect(CONTACT_H1).toContain(SITE_NAME);
    expect(PRIVACY_H1.toLowerCase()).toContain("privacy");
    expect(ABOUT_BODY.length).toBeGreaterThan(MIN_CHARS);
    expect(CONTACT_BODY.length).toBeGreaterThan(MIN_CHARS);
    expect(PRIVACY_BODY.length).toBeGreaterThan(MIN_CHARS);
  });
});

describe("llms.txt", () => {
  it("tells agents when to use propgate, and where the developer resources are", () => {
    expect(LLMS_TXT.startsWith("# propgate")).toBe(true);
    expect(LLMS_TXT).toContain("## When to use this");
    expect(LLMS_TXT).toContain("POST https://api.propgate.dev/v1/checks");
    expect(LLMS_TXT).toContain("openapi.json");
    expect(LLMS_TXT).toContain("authentication");
    expect(LLMS_TXT).toContain("webhooks");
    expect(LLMS_TXT).toContain("@propgate/cli");
    expect(LLMS_TXT).toContain("@propgate/sdk");
  });
});

describe("JSON-LD", () => {
  it("identifies propgate as a SoftwareApplication and an Organization", () => {
    const graph = jsonLd()["@graph"];
    const types = graph.map((node) => node["@type"]);

    expect(types).toContain("SoftwareApplication");
    expect(types).toContain("Organization");

    const org = graph.find((node) => node["@type"] === "Organization") as {
      contactPoint: { contactType: string };
      name: string;
      url: string;
    };

    expect(org.name).toBe(SITE_NAME);
    expect(org.url).toBe(SITE_URL);
    expect(org.contactPoint.contactType).toBe("developer support");
  });
});

describe("published machine-readable files", () => {
  it("keeps public/ in lockstep with this module", () => {
    expect(readFileSync(join(PUBLIC, "llms.txt"), "utf8")).toBe(LLMS_TXT);
    expect(readFileSync(join(PUBLIC, "index.md"), "utf8")).toBe(
      MARKDOWN_FOR_PATH["/"]
    );
    expect(readFileSync(join(PUBLIC, "about.md"), "utf8")).toBe(
      MARKDOWN_FOR_PATH["/about"]
    );
    expect(readFileSync(join(PUBLIC, "contact.md"), "utf8")).toBe(
      MARKDOWN_FOR_PATH["/contact"]
    );
    expect(readFileSync(join(PUBLIC, "privacy.md"), "utf8")).toBe(
      MARKDOWN_FOR_PATH["/privacy"]
    );
  });

  it("has a markdown variant for every indexable path", () => {
    expect(Object.keys(MARKDOWN_FOR_PATH).toSorted()).toEqual(
      [...INDEXABLE_PATHS].toSorted()
    );
  });

  it("points a 404 at the sitemap and llms.txt", () => {
    expect(NOT_FOUND_MARKDOWN).toContain("/sitemap.xml");
    expect(NOT_FOUND_MARKDOWN).toContain("/llms.txt");
    expect(NOT_FOUND_MARKDOWN).toContain("/openapi.json");
  });
});
