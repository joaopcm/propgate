import { documentedOperations } from "@propgate/api-openapi";
import { describe, expect, it } from "vitest";
import { allOperations, buildOpenApi } from "./openapi";

describe("buildOpenApi", () => {
  const spec = buildOpenApi();
  const paths = spec.paths as Record<
    string,
    Record<string, { operationId?: string; description?: string }>
  >;

  it("is OpenAPI 3.1 with the product name", () => {
    const info = spec.info as { title: string };

    expect(spec.openapi).toBe("3.1.0");
    expect(info.title).toContain("propgate");
  });

  it("embeds every product operation from the API document", () => {
    for (const operation of documentedOperations()) {
      const item = paths[operation.path]?.[operation.method.toLowerCase()];

      expect(item?.operationId, operation.path).toBe(operation.operationId);
    }
  });

  it("gives every operation a unique operationId and a description", () => {
    const ids = allOperations().map((operation) => operation.operationId);

    expect(new Set(ids).size).toBe(ids.length);

    for (const operation of allOperations()) {
      expect(
        operation.description.length,
        operation.operationId
      ).toBeGreaterThan(20);
    }
  });

  it("publishes the public checker without inventing a second operationId", () => {
    expect(operationAt("/v1/checks", "post").operationId).toBe(
      "runPublicCheck"
    );
  });

  it("includes the docs catalog on this host", () => {
    expect(operationAt("/v1/status", "get").operationId).toBe("getDocsStatus");
    expect(operationAt("/v1/pages", "get").operationId).toBe("listDocsPages");
  });

  function operationAt(path: string, method: string) {
    const item = paths[path]?.[method];

    if (item === undefined) {
      throw new Error(`missing ${method.toUpperCase()} ${path}`);
    }

    return item;
  }
});
