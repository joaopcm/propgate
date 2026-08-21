import { CHECK_KINDS } from "@propgate/dns";
import { WEBHOOK_EVENTS } from "@propgate/webhooks";
import { ENDPOINTS } from "./api";
import { API_URL, PRODUCT_NAME, SITE_DESCRIPTION, SITE_URL } from "./site";

/**
 * OpenAPI 3.1 for the propgate API, plus the docs catalog on this host.
 *
 * Every product operation has a unique operationId, a description, typed
 * parameters, and response schemas — the shape function-calling needs. The
 * catalog is generated from `ENDPOINTS` so a new route without an operation
 * fails the spec rather than shipping an incomplete document.
 */

type JsonSchema = Record<string, unknown>;

interface Operation {
  readonly description: string;
  readonly method: "delete" | "get" | "patch" | "post";
  readonly operationId: string;
  readonly parameters?: readonly JsonSchema[];
  readonly path: string;
  readonly requestBody?: JsonSchema;
  readonly responses: Record<string, JsonSchema>;
  readonly security?: readonly Record<string, readonly string[]>[];
  readonly servers?: readonly {
    readonly description: string;
    readonly url: string;
  }[];
  readonly summary: string;
  readonly tags: readonly string[];
}

const CHECK_KIND = {
  description: "Which evaluator to run.",
  enum: [...CHECK_KINDS],
  type: "string",
} satisfies JsonSchema;

const ENVELOPE = {
  properties: {
    data: { nullable: true },
    error: { $ref: "#/components/schemas/Error" },
    meta: { nullable: true, type: "object" },
  },
  required: ["data", "error", "meta"],
  type: "object",
} satisfies JsonSchema;

const ERROR_RESPONSE = {
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorEnvelope" },
    },
  },
  description:
    "Structured JSON error. `error.message` names the field that is wrong. On this docs host, `error.code` and `error.hint` are also present.",
};

const BEARER = [{ bearerAuth: [] }];

function pathItem(path: string): string {
  return path.replaceAll(/:([A-Za-z]+)/g, "{$1}");
}

function idParam(name: string, description: string): JsonSchema {
  return {
    description,
    in: "path",
    name,
    required: true,
    schema: { type: "string" },
  };
}

function jsonBody(schema: JsonSchema, required = true): JsonSchema {
  return {
    content: {
      "application/json": { schema },
    },
    required,
  };
}

function ok(
  schema: JsonSchema,
  description: string,
  status = "200"
): Record<string, JsonSchema> {
  return {
    [status]: {
      content: {
        "application/json": { schema },
      },
      description,
    },
    "400": ERROR_RESPONSE,
    "401": ERROR_RESPONSE,
    "404": ERROR_RESPONSE,
    "422": ERROR_RESPONSE,
    "429": ERROR_RESPONSE,
  };
}

const OPERATIONS: readonly Operation[] = [
  {
    description:
      "Diagnose any domain against no account and no profile. The only unauthenticated write that reads DNS. Nothing is registered and no webhook fires. Rate limited to 20 checks a minute per address.",
    method: "post",
    operationId: "checkDomain",
    path: "/v1/checks",
    requestBody: jsonBody({
      properties: {
        caaIssuer: { type: "string" },
        checks: { items: CHECK_KIND, type: "array" },
        cnames: {
          items: {
            properties: {
              label: { type: "string" },
              target: { type: "string" },
            },
            required: ["label", "target"],
            type: "object",
          },
          type: "array",
        },
        dkimSelectors: { items: { type: "string" }, type: "array" },
        domain: {
          description:
            "Must have at least two labels and must not be a public suffix.",
          type: "string",
        },
        expectsMail: { type: "boolean" },
        ownership: {
          items: {
            properties: {
              label: { type: "string" },
              token: { type: "string" },
            },
            required: ["token"],
            type: "object",
          },
          type: "array",
        },
        spfInclude: { type: "string" },
        spfIp: { type: "string" },
      },
      required: ["domain"],
      type: "object",
    }),
    responses: {
      ...ok(
        { $ref: "#/components/schemas/CheckEnvelope" },
        "Diagnosis for the domain."
      ),
    },
    security: [],
    summary:
      "Diagnose any domain. Public, unauthenticated, rate limited by address.",
    tags: ["Checks"],
  },
  {
    description:
      "Start an account. Sends a six-digit code, valid ten minutes. Always answers the same way, whether or not the address is known, so a leaked address list cannot probe who uses propgate.",
    method: "post",
    operationId: "signUp",
    path: "/v1/signup",
    requestBody: jsonBody({
      properties: { email: { type: "string" } },
      required: ["email"],
      type: "object",
    }),
    responses: ok(
      { $ref: "#/components/schemas/EmptyEnvelope" },
      "Code sent, or the same answer if the address is already known.",
      "202"
    ),
    security: [],
    summary: "Start an account. Sends a six-digit code, valid ten minutes.",
    tags: ["Accounts"],
  },
  {
    description:
      "Confirm the address and receive an API key. The code is single-use; the key is shown once and never again.",
    method: "post",
    operationId: "confirmSignUp",
    path: "/v1/signup/confirm",
    requestBody: jsonBody({
      properties: {
        code: { type: "string" },
        email: { type: "string" },
      },
      required: ["code", "email"],
      type: "object",
    }),
    responses: ok(
      { $ref: "#/components/schemas/CreatedApiKeyEnvelope" },
      "The key, shown once."
    ),
    security: [],
    summary: "Confirm the address and receive an API key.",
    tags: ["Accounts"],
  },
  {
    description:
      "Create an API key. The secret is returned once and never again — only its hash is stored.",
    method: "post",
    operationId: "createApiKey",
    path: "/v1/api-keys",
    requestBody: jsonBody({
      properties: { name: { type: "string" } },
      required: ["name"],
      type: "object",
    }),
    responses: ok(
      { $ref: "#/components/schemas/CreatedApiKeyEnvelope" },
      "The new key."
    ),
    security: BEARER,
    summary: "Create an API key.",
    tags: ["API keys"],
  },
  {
    description:
      "Your keys, oldest first, revoked ones included, each with the address that created it. Prefixes only; no endpoint returns a secret.",
    method: "get",
    operationId: "listApiKeys",
    path: "/v1/api-keys",
    responses: ok(
      { $ref: "#/components/schemas/ApiKeyListEnvelope" },
      "Keys for this account."
    ),
    security: BEARER,
    summary: "List API keys.",
    tags: ["API keys"],
  },
  {
    description:
      "Revoke a key. Takes effect on the next request. Revoking your last active key is refused.",
    method: "delete",
    operationId: "revokeApiKey",
    parameters: [idParam("id", "Key id or prefix.")],
    path: "/v1/api-keys/:id",
    responses: ok(
      { $ref: "#/components/schemas/ApiKeyEnvelope" },
      "The revoked key."
    ),
    security: BEARER,
    summary: "Revoke an API key.",
    tags: ["API keys"],
  },
  {
    description:
      "Who is on this account. Read-only — a member is added by proving control of a mailbox through signup.",
    method: "get",
    operationId: "listMembers",
    path: "/v1/members",
    responses: ok(
      { $ref: "#/components/schemas/MemberListEnvelope" },
      "Members of this account."
    ),
    security: BEARER,
    summary: "List members.",
    tags: ["Members"],
  },
  {
    description:
      "Create a profile version. Editing a profile writes a new version; it never changes an existing one. Domains pin the version they were registered against.",
    method: "post",
    operationId: "createProfile",
    path: "/v1/profiles",
    requestBody: jsonBody({
      properties: {
        key: { type: "string" },
        requirements: {
          items: { $ref: "#/components/schemas/ProfileRequirement" },
          minItems: 1,
          type: "array",
        },
      },
      required: ["key", "requirements"],
      type: "object",
    }),
    responses: ok(
      { $ref: "#/components/schemas/ProfileEnvelope" },
      "The new profile version."
    ),
    security: BEARER,
    summary: "Create a profile version.",
    tags: ["Profiles"],
  },
  {
    description:
      "The current version of a profile. Editing writes a new version; this is the one domains pin against unless they were registered on an older one.",
    method: "get",
    operationId: "getProfile",
    parameters: [idParam("key", "Profile key.")],
    path: "/v1/profiles/:key",
    responses: ok(
      { $ref: "#/components/schemas/ProfileEnvelope" },
      "The current version."
    ),
    security: BEARER,
    summary: "Get a profile.",
    tags: ["Profiles"],
  },
  {
    description:
      "Register a domain against a profile, with the values that profile requires per domain. Does not touch DNS. The domain starts pending.",
    method: "post",
    operationId: "registerDomain",
    path: "/v1/domains",
    requestBody: jsonBody({
      properties: {
        expectations: {
          additionalProperties: { type: "object" },
          type: "object",
        },
        externalId: { type: "string" },
        name: { type: "string" },
        profileKey: { type: "string" },
      },
      required: ["name", "profileKey"],
      type: "object",
    }),
    responses: ok(
      { $ref: "#/components/schemas/DomainEnvelope" },
      "The registered domain."
    ),
    security: BEARER,
    summary: "Register a domain against a profile.",
    tags: ["Domains"],
  },
  {
    description:
      "Change the values a domain is judged against, the profile it is pinned to, or both. Resets it to pending; fires no webhook.",
    method: "patch",
    operationId: "updateDomain",
    parameters: [idParam("id", "Domain id.")],
    path: "/v1/domains/:id",
    requestBody: jsonBody({
      properties: {
        expectations: {
          additionalProperties: { type: "object" },
          type: "object",
        },
        externalId: { nullable: true, type: "string" },
        profileKey: { type: "string" },
      },
      type: "object",
    }),
    responses: ok(
      { $ref: "#/components/schemas/DomainEnvelope" },
      "The updated domain."
    ),
    security: BEARER,
    summary: "Update a domain.",
    tags: ["Domains"],
  },
  {
    description:
      "Verify the domain now. Runs the checks, updates the state, returns a result per requirement.",
    method: "post",
    operationId: "verifyDomain",
    parameters: [idParam("id", "Domain id.")],
    path: "/v1/domains/:id/checks",
    responses: ok(
      { $ref: "#/components/schemas/DomainDetailEnvelope" },
      "The verified domain."
    ),
    security: BEARER,
    summary: "Verify a domain now.",
    tags: ["Domains"],
  },
  {
    description:
      "Your domains, oldest first. Cursor paging, filterable by state and by your own external id.",
    method: "get",
    operationId: "listDomains",
    parameters: [
      {
        description: "Opaque cursor from the previous page.",
        in: "query",
        name: "cursor",
        schema: { type: "string" },
      },
      {
        description: "Page size, 1–200. Defaults to 50.",
        in: "query",
        name: "limit",
        schema: { type: "integer" },
      },
      {
        description: "Filter by lifecycle state.",
        in: "query",
        name: "state",
        schema: {
          enum: ["pending", "verifying", "verified", "degraded", "failed"],
          type: "string",
        },
      },
      {
        description: "Filter by the external id you supplied at registration.",
        in: "query",
        name: "externalId",
        schema: { type: "string" },
      },
    ],
    path: "/v1/domains",
    responses: ok(
      { $ref: "#/components/schemas/DomainListEnvelope" },
      "A page of domains."
    ),
    security: BEARER,
    summary: "List domains.",
    tags: ["Domains"],
  },
  {
    description:
      "The last known state, per-requirement results, and every lookup behind them.",
    method: "get",
    operationId: "getDomain",
    parameters: [idParam("id", "Domain id.")],
    path: "/v1/domains/:id",
    responses: ok(
      { $ref: "#/components/schemas/DomainDetailEnvelope" },
      "One domain."
    ),
    security: BEARER,
    summary: "Get a domain.",
    tags: ["Domains"],
  },
  {
    description:
      "What has changed for this domain, newest first. Appended to only when an observation actually differs.",
    method: "get",
    operationId: "getDomainTimeline",
    parameters: [
      idParam("id", "Domain id."),
      {
        in: "query",
        name: "cursor",
        schema: { type: "string" },
      },
      {
        in: "query",
        name: "limit",
        schema: { type: "integer" },
      },
    ],
    path: "/v1/domains/:id/timeline",
    responses: ok(
      { $ref: "#/components/schemas/TimelineEnvelope" },
      "Recorded changes."
    ),
    security: BEARER,
    summary: "Domain timeline.",
    tags: ["Domains"],
  },
  {
    description:
      "Stop tracking the domain. Further checks and webhooks stop; the id is not reused.",
    method: "delete",
    operationId: "deleteDomain",
    parameters: [idParam("id", "Domain id.")],
    path: "/v1/domains/:id",
    responses: ok(
      { $ref: "#/components/schemas/DomainEnvelope" },
      "The deleted domain."
    ),
    security: BEARER,
    summary: "Delete a domain.",
    tags: ["Domains"],
  },
  {
    description:
      "Register an endpoint. Idempotent on the URL; the signing secret is returned only on the call that creates it.",
    method: "post",
    operationId: "createWebhook",
    path: "/v1/webhooks",
    requestBody: jsonBody({
      properties: {
        events: {
          items: { enum: [...WEBHOOK_EVENTS], type: "string" },
          type: "array",
        },
        url: { type: "string" },
      },
      required: ["url"],
      type: "object",
    }),
    responses: ok(
      { $ref: "#/components/schemas/CreatedWebhookEnvelope" },
      "The endpoint."
    ),
    security: BEARER,
    summary: "Create a webhook endpoint.",
    tags: ["Webhooks"],
  },
  {
    description: "Your endpoints. An empty events array means every event.",
    method: "get",
    operationId: "listWebhooks",
    path: "/v1/webhooks",
    responses: ok(
      { $ref: "#/components/schemas/WebhookListEnvelope" },
      "Endpoints."
    ),
    security: BEARER,
    summary: "List webhook endpoints.",
    tags: ["Webhooks"],
  },
  {
    description:
      "One webhook endpoint: URL, subscribed events, and whether it is disabled.",
    method: "get",
    operationId: "getWebhook",
    parameters: [idParam("id", "Endpoint id.")],
    path: "/v1/webhooks/:id",
    responses: ok(
      { $ref: "#/components/schemas/WebhookEnvelope" },
      "One endpoint."
    ),
    security: BEARER,
    summary: "Get a webhook endpoint.",
    tags: ["Webhooks"],
  },
  {
    description:
      "Change which events an endpoint receives, or disable it. Both fields are optional; omitting both changes nothing.",
    method: "patch",
    operationId: "updateWebhook",
    parameters: [idParam("id", "Endpoint id.")],
    path: "/v1/webhooks/:id",
    requestBody: jsonBody({
      properties: {
        disabled: { type: "boolean" },
        events: {
          items: { enum: [...WEBHOOK_EVENTS], type: "string" },
          type: "array",
        },
      },
      type: "object",
    }),
    responses: ok(
      { $ref: "#/components/schemas/WebhookEnvelope" },
      "The updated endpoint."
    ),
    security: BEARER,
    summary: "Update a webhook endpoint.",
    tags: ["Webhooks"],
  },
  {
    description:
      "Remove a webhook endpoint. Nothing further is delivered to it; past deliveries remain queryable until they age out.",
    method: "delete",
    operationId: "deleteWebhook",
    parameters: [idParam("id", "Endpoint id.")],
    path: "/v1/webhooks/:id",
    responses: ok(
      { $ref: "#/components/schemas/WebhookEnvelope" },
      "The removed endpoint."
    ),
    security: BEARER,
    summary: "Delete a webhook endpoint.",
    tags: ["Webhooks"],
  },
  {
    description:
      "Issue a new signing secret. The previous one keeps verifying for a window of up to 168 hours, so a deploy does not have to be instant. Zero expires it immediately.",
    method: "post",
    operationId: "rotateWebhookSecret",
    parameters: [idParam("id", "Endpoint id.")],
    path: "/v1/webhooks/:id/secret",
    requestBody: jsonBody(
      {
        properties: { expirePreviousInHours: { type: "number" } },
        type: "object",
      },
      false
    ),
    responses: ok(
      { $ref: "#/components/schemas/WebhookSecretEnvelope" },
      "The new secret."
    ),
    security: BEARER,
    summary: "Rotate a webhook signing secret.",
    tags: ["Webhooks"],
  },
  {
    description:
      "What has been sent to this endpoint, newest first. Cursor paging, filterable by status.",
    method: "get",
    operationId: "listWebhookDeliveries",
    parameters: [
      idParam("id", "Endpoint id."),
      {
        in: "query",
        name: "cursor",
        schema: { type: "string" },
      },
      {
        in: "query",
        name: "limit",
        schema: { type: "integer" },
      },
      {
        in: "query",
        name: "status",
        schema: { enum: ["pending", "delivered", "failed"], type: "string" },
      },
    ],
    path: "/v1/webhooks/:id/deliveries",
    responses: ok(
      { $ref: "#/components/schemas/DeliveryListEnvelope" },
      "Deliveries."
    ),
    security: BEARER,
    summary: "List webhook deliveries.",
    tags: ["Webhooks"],
  },
  {
    description:
      "Docs site health. Public, no key. Confirms this host is the propgate docs surface and points at the product API.",
    method: "get",
    operationId: "getDocsStatus",
    path: "/v1/status",
    responses: ok({ $ref: "#/components/schemas/StatusEnvelope" }, "ok"),
    security: [],
    servers: [{ description: "propgate docs", url: SITE_URL }],
    summary: "Docs site status.",
    tags: ["Docs"],
  },
  {
    description:
      "Machine-readable catalog of propgate docs pages, with HTML and markdown URLs. Public, no key.",
    method: "get",
    operationId: "listDocsPages",
    path: "/v1/pages",
    responses: ok(
      { $ref: "#/components/schemas/CatalogEnvelope" },
      "The page catalog."
    ),
    security: [],
    servers: [{ description: "propgate docs", url: SITE_URL }],
    summary: "List docs pages.",
    tags: ["Docs"],
  },
];

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

export function buildOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const operation of OPERATIONS) {
    const path = pathItem(operation.path);
    const item = paths[path] ?? {};
    item[operation.method] = {
      description: operation.description,
      operationId: operation.operationId,
      ...(operation.parameters === undefined
        ? {}
        : { parameters: operation.parameters }),
      ...(operation.requestBody === undefined
        ? {}
        : { requestBody: operation.requestBody }),
      responses: operation.responses,
      ...(operation.security === undefined
        ? {}
        : { security: operation.security }),
      ...(operation.servers === undefined
        ? {}
        : { servers: operation.servers }),
      summary: operation.summary,
      tags: operation.tags,
    };
    paths[path] = item;
  }

  return {
    components: {
      schemas: {
        ApiKey: {
          properties: {
            createdAt: { type: "string" },
            createdBy: { nullable: true, type: "string" },
            id: { type: "string" },
            lastUsedAt: { nullable: true, type: "string" },
            name: { type: "string" },
            object: { const: "api_key", type: "string" },
            prefix: { type: "string" },
            revoked: { type: "boolean" },
            revokedAt: { nullable: true, type: "string" },
          },
          required: ["id", "name", "object", "prefix", "revoked"],
          type: "object",
        },
        ApiKeyEnvelope: envelopeOf({ $ref: "#/components/schemas/ApiKey" }),
        ApiKeyListEnvelope: envelopeOf({
          items: { $ref: "#/components/schemas/ApiKey" },
          type: "array",
        }),
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
        Check: {
          properties: {
            checks: { type: "array" },
            domain: { type: "string" },
            elapsedMs: { type: "number" },
            findings: { type: "array" },
            object: { const: "check", type: "string" },
            verdict: {
              enum: ["pass", "warn", "fail", "indeterminate"],
              type: "string",
            },
          },
          required: ["checks", "domain", "findings", "object", "verdict"],
          type: "object",
        },
        CheckEnvelope: envelopeOf({ $ref: "#/components/schemas/Check" }),
        CreatedApiKey: {
          allOf: [
            { $ref: "#/components/schemas/ApiKey" },
            {
              properties: { key: { type: "string" } },
              required: ["key"],
              type: "object",
            },
          ],
        },
        CreatedApiKeyEnvelope: envelopeOf({
          $ref: "#/components/schemas/CreatedApiKey",
        }),
        CreatedWebhookEnvelope: envelopeOf({
          $ref: "#/components/schemas/Webhook",
        }),
        DeliveryListEnvelope: envelopeOf({
          items: { type: "object" },
          type: "array",
        }),
        Domain: {
          properties: {
            createdAt: { type: "string" },
            externalId: { nullable: true, type: "string" },
            id: { type: "string" },
            lastCheckedAt: { nullable: true, type: "string" },
            name: { type: "string" },
            object: { const: "domain", type: "string" },
            profileVersionId: { type: "string" },
            state: {
              enum: ["pending", "verifying", "verified", "degraded", "failed"],
              type: "string",
            },
            verdict: {
              enum: ["pass", "warn", "fail", "indeterminate"],
              nullable: true,
              type: "string",
            },
          },
          required: ["id", "name", "object", "state"],
          type: "object",
        },
        DomainDetailEnvelope: envelopeOf({
          $ref: "#/components/schemas/Domain",
        }),
        DomainEnvelope: envelopeOf({ $ref: "#/components/schemas/Domain" }),
        DomainListEnvelope: envelopeOf({
          items: { $ref: "#/components/schemas/Domain" },
          type: "array",
        }),
        EmptyEnvelope: ENVELOPE,
        Error: {
          properties: {
            code: {
              description:
                "Stable machine code. Present on docs.propgate.dev errors.",
              type: "string",
            },
            hint: {
              description:
                "What to do next. Present on docs.propgate.dev errors.",
              type: "string",
            },
            message: { type: "string" },
          },
          required: ["message"],
          type: "object",
        },
        ErrorEnvelope: ENVELOPE,
        MemberListEnvelope: envelopeOf({
          items: {
            properties: {
              createdAt: { type: "string" },
              email: { type: "string" },
              id: { type: "string" },
              object: { const: "member", type: "string" },
            },
            required: ["email", "id", "object"],
            type: "object",
          },
          type: "array",
        }),
        Profile: {
          properties: {
            id: { type: "string" },
            key: { type: "string" },
            object: { const: "profile", type: "string" },
            requirements: {
              items: { $ref: "#/components/schemas/ProfileRequirement" },
              type: "array",
            },
            version: { type: "integer" },
          },
          required: ["id", "key", "object", "requirements", "version"],
          type: "object",
        },
        ProfileEnvelope: envelopeOf({ $ref: "#/components/schemas/Profile" }),
        ProfileRequirement: {
          properties: {
            caaIssuer: { type: "string" },
            check: CHECK_KIND,
            expectedPublicKey: { type: "string" },
            expectsMail: { type: "boolean" },
            include: { type: "string" },
            key: { type: "string" },
            label: { type: "string" },
            requiredPerDomain: { items: { type: "string" }, type: "array" },
            selector: { type: "string" },
            target: { type: "string" },
            token: { type: "string" },
          },
          required: ["check", "key"],
          type: "object",
        },
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
        TimelineEnvelope: envelopeOf({
          items: { type: "object" },
          type: "array",
        }),
        Webhook: {
          properties: {
            createdAt: { type: "string" },
            disabled: { type: "boolean" },
            events: { items: { type: "string" }, type: "array" },
            id: { type: "string" },
            object: { const: "webhook", type: "string" },
            secret: { type: "string" },
            url: { type: "string" },
          },
          required: ["id", "object", "url"],
          type: "object",
        },
        WebhookEnvelope: envelopeOf({ $ref: "#/components/schemas/Webhook" }),
        WebhookListEnvelope: envelopeOf({
          items: { $ref: "#/components/schemas/Webhook" },
          type: "array",
        }),
        WebhookSecretEnvelope: envelopeOf({
          properties: {
            id: { type: "string" },
            object: { const: "webhook_secret", type: "string" },
            secret: { type: "string" },
          },
          required: ["id", "object", "secret"],
          type: "object",
        }),
      },
      securitySchemes: {
        bearerAuth: {
          description:
            "A propgate API key. Mint one with POST /v1/signup then POST /v1/signup/confirm, or POST /v1/api-keys.",
          scheme: "bearer",
          type: "http",
        },
      },
    },
    info: {
      description: `${SITE_DESCRIPTION} Product API at ${API_URL}. Docs catalog at ${SITE_URL}.`,
      title: `${PRODUCT_NAME} API`,
      version: "1.0.0",
    },
    openapi: "3.1.0",
    paths,
    servers: [
      { description: "propgate API", url: API_URL },
      { description: "propgate docs catalog", url: SITE_URL },
    ],
  };
}

export function productOperations(): readonly Operation[] {
  return OPERATIONS.filter((operation) => operation.tags[0] !== "Docs");
}

export function allOperations(): readonly Operation[] {
  return OPERATIONS;
}

export function operationCoverage(): {
  readonly extra: readonly string[];
  readonly missing: readonly string[];
} {
  const documented = new Set(
    productOperations().map(
      (operation) => `${operation.method.toUpperCase()} ${operation.path}`
    )
  );
  const implemented = new Set(
    ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`)
  );

  return {
    extra: [...documented]
      .filter((signature) => !implemented.has(signature))
      .toSorted((left, right) => left.localeCompare(right)),
    missing: [...implemented]
      .filter((signature) => !documented.has(signature))
      .toSorted((left, right) => left.localeCompare(right)),
  };
}
