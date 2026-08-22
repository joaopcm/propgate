import { DIAGNOSIS_REGISTRY } from "@propgate/dns";
import { describe, expect, it } from "vitest";
import { allEntries, entryBySlug, families, unfiled } from "./taxonomy";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe("slugs", () => {
  it("are unique", () => {
    const slugs = Object.values(DIAGNOSIS_REGISTRY).map(
      (definition) => definition.slug
    );

    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("are safe in a URL without escaping", () => {
    for (const definition of Object.values(DIAGNOSIS_REGISTRY)) {
      expect(definition.slug, definition.code).toMatch(SLUG);
      expect(encodeURIComponent(definition.slug)).toBe(definition.slug);
    }
  });

  it("resolve to the code they belong to", () => {
    for (const definition of Object.values(DIAGNOSIS_REGISTRY)) {
      const found = entryBySlug(definition.slug);

      if (found === undefined) {
        throw new Error(`no page resolves for ${definition.code}`);
      }

      expect(found.definition.code).toBe(definition.code);
    }
  });

  it("does not resolve one that does not exist", () => {
    expect(entryBySlug("not-a-code")).toBeUndefined();
  });
});

describe("the index", () => {
  it("files every code under a family", () => {
    expect(unfiled()).toEqual([]);
  });

  it("lists each code exactly once", () => {
    const listed = families().flatMap((family) =>
      family.entries.map((entry) => entry.definition.code)
    );

    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).toHaveLength(Object.keys(DIAGNOSIS_REGISTRY).length);
  });
});

describe("every code can say how we know", () => {
  it("has either a fixture or a written reason it cannot have one", () => {
    for (const entry of allEntries()) {
      const documented =
        entry.fixtures.length > 0 || entry.unreproducible !== undefined;

      expect(documented, entry.definition.code).toBe(true);
    }
  });

  it("carries the fixture's own reason, not a restatement", () => {
    const withFixture = allEntries().find((entry) => entry.fixtures.length > 0);

    expect(withFixture?.fixtures[0]?.reason.length).toBeGreaterThan(30);
  });
});
