import { documentedOperations, openApiDocument } from "@propgate/api-openapi";
import { API_URL, PRODUCT_NAME, PRODUCT_URL, SITE_URL } from "./site";

/**
 * OpenAPI 3.1 for this host: the product document plus the docs catalog.
 *
 * Product operations come from `apps/api/src/openapi.ts`. That file is the
 * source of truth (also published at api.propgate.dev/openapi.json and
 * propgate.dev/openapi.json). Re-embedding it here means a new API route
 * cannot ship on docs without shipping in the API spec.
 */

type JsonSchema = Record<string, unknown>;

interface OpenApiDoc {
  readonly components: {
    readonly schemas: Record<string, unknown>;
    readonly securitySchemes: Record<string, unknown>;
  };
  readonly info: {
    readonly description: string;
    readonly title: string;
    readonly version: string;
  };
  readonly openapi: string;
  readonly paths: Record<string, Record<string, unknown>>;
  readonly servers: readonly {
    readonly description: string;
    readonly url: string;
  }[];
  readonly tags: readonly { readonly name: string }[];
}

export interface CatalogOperation {
  readonly description: string;
  readonly method: "get";
  readonly operationId: string;
  readonly path: string;
}

const CATALOG_ERROR = {
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ApiError" },
    },
  },
  description: "Structured JSON error with code, message, and hint.",
};

function envelopeOf(data: JsonSchema): JsonSchema {
  return {
    properties: {
      data,
      error: { nullable: true, type: "object" },
      meta: { nullable: true, type: "object" },
    },
    required: ["data", "error", "meta"],
    type: "object",
  };
}

function catalogGet(
  operationId: string,
  summary: string,
  description: string,
  schemaRef: string,
  responseDescription: string
): JsonSchema {
  return {
    description,
    operationId,
    responses: {
      "200": {
        content: {
          "application/json": {
            schema: { $ref: schemaRef },
          },
        },
        description: responseDescription,
      },
      "404": CATALOG_ERROR,
    },
    security: [],
    servers: [{ description: "propgate docs", url: SITE_URL }],
    summary,
    tags: ["Docs"],
  };
}

const CATALOG: readonly CatalogOperation[] = [
  {
    description:
      "Docs site health. Public, no key. Confirms this host is the propgate docs surface and points at the product API.",
    method: "get",
    operationId: "getDocsStatus",
    path: "/v1/status",
  },
  {
    description:
      "Machine-readable catalog of propgate docs pages, with HTML and markdown URLs. Public, no key.",
    method: "get",
    operationId: "listDocsPages",
    path: "/v1/pages",
  },
];

export function buildOpenApi(): Record<string, unknown> {
  const product = openApiDocument as unknown as OpenApiDoc;

  return {
    ...product,
    components: {
      ...product.components,
      schemas: {
        ...product.components.schemas,
        CatalogEnvelope: envelopeOf({
          properties: {
            name: { type: "string" },
            object: { const: "catalog", type: "string" },
            pages: {
              items: {
                properties: {
                  href: { type: "string" },
                  htmlUrl: { type: "string" },
                  markdownUrl: { type: "string" },
                  title: { type: "string" },
                },
                required: ["href", "htmlUrl", "markdownUrl", "title"],
                type: "object",
              },
              type: "array",
            },
          },
          required: ["name", "object", "pages"],
          type: "object",
        }),
        StatusEnvelope: envelopeOf({
          properties: {
            api: { type: "string" },
            name: { type: "string" },
            object: { const: "status", type: "string" },
            openapi: { type: "string" },
            status: { const: "ok", type: "string" },
          },
          required: ["api", "name", "object", "openapi", "status"],
          type: "object",
        }),
      },
    },
    info: {
      ...product.info,
      description: `${product.info.description} This copy on ${SITE_URL} adds the docs catalog (GET /v1/status, GET /v1/pages). Product operations are the same document as ${API_URL}/openapi.json and ${PRODUCT_URL}/openapi.json.`,
      title: `${PRODUCT_NAME} API`,
    },
    paths: {
      ...product.paths,
      "/v1/pages": {
        get: catalogGet(
          "listDocsPages",
          "List docs pages.",
          "Machine-readable catalog of propgate docs pages, with HTML and markdown URLs. Public, no key.",
          "#/components/schemas/CatalogEnvelope",
          "The page catalog."
        ),
      },
      "/v1/status": {
        get: catalogGet(
          "getDocsStatus",
          "Docs site status.",
          "Docs site health. Public, no key. Confirms this host is the propgate docs surface and points at the product API.",
          "#/components/schemas/StatusEnvelope",
          "ok"
        ),
      },
    },
    servers: [
      ...product.servers,
      { description: "propgate docs catalog", url: SITE_URL },
    ],
    tags: [...product.tags, { name: "Docs" }],
  };
}

export function allOperations(): readonly {
  readonly description: string;
  readonly method: string;
  readonly operationId: string;
  readonly path: string;
}[] {
  return [
    ...documentedOperations(),
    ...CATALOG.map((operation) => ({
      description: operation.description,
      method: operation.method.toUpperCase(),
      operationId: operation.operationId,
      path: operation.path,
    })),
  ];
}
