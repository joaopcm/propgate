import { PER_DOMAIN_FIELDS_BY_CHECK } from "@propgate/db/src/schema/profiles";
import { CHECK_KINDS, REPEATABLE_CHECK_KINDS } from "@propgate/dns";
import { describe, expect, it } from "vitest";
import { ENDPOINTS, REQUIREMENT_TYPES, VERDICTS } from "./api";

describe("requirement types", () => {
  it("documents every check the resolver can run", () => {
    expect(Object.keys(REQUIREMENT_TYPES).toSorted()).toEqual(
      [...CHECK_KINDS].toSorted()
    );
  });

  it("documents the repeatable requirements, and only those", () => {
    const repeatable = Object.entries(REQUIREMENT_TYPES)
      .filter(([, type]) => type.repeatable)
      .map(([kind]) => kind)
      .toSorted();

    expect(repeatable).toEqual([...REPEATABLE_CHECK_KINDS].toSorted());
  });

  it("says something about each one", () => {
    for (const [kind, type] of Object.entries(REQUIREMENT_TYPES)) {
      expect(type.summary.length, kind).toBeGreaterThan(40);
    }
  });

  it("documents exactly the fields a profile can defer to the domain", () => {
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
