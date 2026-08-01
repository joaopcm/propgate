import { DIAGNOSIS_REGISTRY } from "@propgate/dns";
import { describe, expect, it } from "vitest";
import { allEntries, entryBySlug, families, unfiled } from "./taxonomy";

/**
 * Guards on the published taxonomy.
 *
 * The coverage guard in `@propgate/dns` already proves every code has a fixture
 * or a written reason. What it cannot see is whether this site can actually
 * render them — which is the half a customer meets.
 */

describe("slugs", () => {
  it("are unique", () => {
    // A duplicate would collide as a route and silently hide one of the two
    // codes behind it, while both keep appearing in API responses that link
    // here. Nothing else in the build would notice.
    const slugs = Object.values(DIAGNOSIS_REGISTRY).map(
      (definition) => definition.slug
    );

    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("are safe in a URL without escaping", () => {
    for (const definition of Object.values(DIAGNOSIS_REGISTRY)) {
      expect(definition.slug, definition.code).toMatch(
        /^[a-z0-9]+(-[a-z0-9]+)*$/
      );
      expect(encodeURIComponent(definition.slug)).toBe(definition.slug);
    }
  });

  it("resolve to the code they belong to", () => {
    for (const definition of Object.values(DIAGNOSIS_REGISTRY)) {
      expect(entryBySlug(definition.slug)?.definition.code).toBe(
        definition.code
      );
    }
  });

  it("does not resolve one that does not exist", () => {
    expect(entryBySlug("not-a-code")).toBeUndefined();
  });
});

describe("the index", () => {
  it("files every code under a family", () => {
    // A code with an unrecognised prefix would vanish from the index while
    // staying reachable at its own URL — reachable only by someone who already
    // knew the slug, which defeats the page.
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
    // The same contract the coverage guard enforces, asserted from the
    // rendering side: a page with an empty "How we know" section is a page that
    // asks the reader to take our word for it.
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
