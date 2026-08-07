import { PER_DOMAIN_FIELDS_BY_CHECK } from "@propgate/db/src/schema/profiles";
import { CHECK_KINDS } from "@propgate/dns";
import { describe, expect, it } from "vitest";
import { ENDPOINTS, REQUIREMENT_TYPES, VERDICTS } from "./api";

/**
 * The published reference against the code it describes.
 *
 * `Record<CheckKind, …>` already makes a missing requirement type a `tsc`
 * error. These cover what the types cannot: that the tables are populated
 * rather than merely present, and that nothing is documented twice.
 */

describe("requirement types", () => {
  it("documents every check the resolver can run", () => {
    expect(Object.keys(REQUIREMENT_TYPES).toSorted()).toEqual(
      [...CHECK_KINDS].toSorted()
    );
  });

  it("documents exactly one repeatable requirement", () => {
    // DKIM answers a question per selector; everything else answers one per
    // domain. If a second kind becomes repeatable, `rejectDefinition` in the
    // API has to change with it.
    const repeatable = Object.entries(REQUIREMENT_TYPES)
      .filter(([, type]) => type.repeatable)
      .map(([kind]) => kind);

    expect(repeatable).toEqual(["dkim"]);
  });

  it("says something about each one", () => {
    for (const [kind, type] of Object.entries(REQUIREMENT_TYPES)) {
      expect(type.summary.length, kind).toBeGreaterThan(40);
    }
  });

  it("documents exactly the fields a profile can defer to the domain", () => {
    /**
     * A deep import rather than a package one, and in the spec rather than in
     * `api.ts`, so the Next build does not pull a database driver in to render a
     * table. The published reference still cannot omit a deferrable field or
     * invent one: this is the source of truth, and the docs are the copy.
     */
    for (const [kind, type] of Object.entries(REQUIREMENT_TYPES)) {
      expect([...type.perDomain].toSorted(), kind).toEqual(
        [
          ...PER_DOMAIN_FIELDS_BY_CHECK[
            kind as keyof typeof PER_DOMAIN_FIELDS_BY_CHECK
          ],
        ].toSorted()
      );
    }
  });

  it("only advertises a per-domain field it also documents", () => {
    // Otherwise a field appears in `requiredPerDomain` with nothing on the page
    // explaining what value it takes.
    for (const [kind, type] of Object.entries(REQUIREMENT_TYPES)) {
      const documented = type.fields.map((field) => field.name);

      for (const field of type.perDomain) {
        expect(documented, `${kind}.${field}`).toContain(field);
      }
    }
  });
});

describe("verdicts", () => {
  it("is the only one where nothing changes", () => {
    // The distinction the whole stack preserves. If a second verdict ever
    // becomes a no-op, the state machine and this page have both moved.
    const inert = Object.entries(VERDICTS)
      .filter(([, meaning]) => meaning.effect.startsWith("Changes nothing"))
      .map(([verdict]) => verdict);

    expect(inert).toEqual(["indeterminate"]);
  });
});

describe("endpoints", () => {
  it("lists each path and method once", () => {
    const signatures = ENDPOINTS.map(
      (endpoint) => `${endpoint.method} ${endpoint.path}`
    );

    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("keeps registration and verification as separate calls", () => {
    // Documented as one call, they would be built as one call, and importing
    // tens of thousands of domains would fire tens of thousands of DNS runs.
    expect(
      ENDPOINTS.some(
        (endpoint) =>
          endpoint.method === "POST" && endpoint.path === "/v1/domains"
      )
    ).toBe(true);
    expect(
      ENDPOINTS.some(
        (endpoint) =>
          endpoint.method === "POST" &&
          endpoint.path === "/v1/domains/:id/checks"
      )
    ).toBe(true);
  });
});
