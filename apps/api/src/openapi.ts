const API = "https://api.propgate.dev";
const DOCS = "https://docs.propgate.dev";

const bearer = [{ BearerAuth: [] }];

const errorSchema = {
  additionalProperties: false,
  properties: {
    code: {
      description:
        "Stable machine name. The same set @propgate/sdk exposes as PropgateErrorCode for HTTP failures.",
      type: "string",
    },
    hint: {
      description: "What to do next. Written for an agent, not a dashboard.",
      type: "string",
    },
    message: {
      description: "What went wrong, naming the field when one is at fault.",
      type: "string",
    },
  },
  required: ["code", "hint", "message"],
  type: "object",
} as const;

const envelope = (data: Record<string, unknown>, nullableData = false) => ({
  additionalProperties: false,
  properties: {
    data: nullableData ? { anyOf: [{ type: "null" }, data] } : data,
    error: {
      anyOf: [{ type: "null" }, errorSchema],
    },
    meta: {
      anyOf: [{ type: "null" }, { additionalProperties: true, type: "object" }],
    },
  },
  required: ["data", "error", "meta"],
  type: "object",
});

const errorResponse = (description: string) => ({
  content: {
    "application/json": {
      schema: envelope({ type: "null" }, true),
    },
  },
  description,
});

const jsonBody = (schema: Record<string, unknown>) => ({
  content: {
    "application/json": { schema },
  },
  required: true,
});

const verdict = {
  description: "pass, warn, fail, or indeterminate — not a boolean.",
  enum: ["fail", "indeterminate", "pass", "warn"],
  type: "string",
} as const;

const checkKind = {
  enum: [
    "caa",
    "cname",
    "delegation",
    "dkim",
    "dmarc",
    "mx",
    "ownership",
    "spf",
  ],
  type: "string",
} as const;

const finding = {
  additionalProperties: false,
  properties: {
    code: { type: "string" },
    evidence: { additionalProperties: true, type: "object" },
    severity: { enum: ["error", "info", "warning"], type: "string" },
    slug: {
      description: `Path segment on ${DOCS}/taxonomy/{slug}.`,
      type: "string",
    },
    summary: { type: "string" },
  },
  required: ["code", "evidence", "severity", "slug", "summary"],
  type: "object",
} as const;

const lookup = {
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    purpose: { type: "string" },
    server: { description: "address:port that answered.", type: "string" },
    status: { type: "string" },
    type: {
      description: "DNS RR type number, e.g. 16 for TXT.",
      type: "integer",
    },
  },
  required: ["name", "purpose", "server", "status", "type"],
  type: "object",
} as const;

const checkOutcome = {
  additionalProperties: false,
  properties: {
    findings: { items: finding, type: "array" },
    kind: checkKind,
    lookups: { items: lookup, type: "array" },
    verdict,
  },
  required: ["findings", "kind", "lookups", "verdict"],
  type: "object",
} as const;

const check = {
  additionalProperties: false,
  properties: {
    checks: { items: checkOutcome, type: "array" },
    domain: { type: "string" },
    elapsedMs: { type: "integer" },
    findings: { items: finding, type: "array" },
    object: { const: "check", type: "string" },
    verdict,
  },
  required: ["checks", "domain", "elapsedMs", "findings", "object", "verdict"],
  type: "object",
} as const;

const domainState = {
  enum: ["degraded", "failed", "pending", "verified", "verifying"],
  type: "string",
} as const;

const webhookEvent = {
  enum: [
    "domain.degraded",
    "domain.failed",
    "domain.recovered",
    "domain.verified",
  ],
  type: "string",
} as const;

function op(
  operationId: string,
  summary: string,
  description: string,
  rest: Record<string, unknown>
) {
  return { description, operationId, summary, ...rest };
}

export const openApiDocument = {
  components: {
    schemas: {
      ApiError: errorSchema,
      Check: check,
      CheckKind: checkKind,
      Finding: finding,
      Lookup: lookup,
      Verdict: verdict,
    },
    securitySchemes: {
      BearerAuth: {
        bearerFormat: "pg_live_",
        description:
          "A key minted by POST /v1/signup/confirm or POST /v1/api-keys. The public checker (POST /v1/checks) does not need one.",
        scheme: "bearer",
        type: "http",
      },
    },
  },
  info: {
    description: [
      "Domain verification that tells you what is wrong, not just that something is.",
      `Human docs: ${DOCS}/api. CLI: npx @propgate/cli. SDK: npm install @propgate/sdk.`,
      "Every JSON response except GET /health uses `{ data, error, meta }`. Errors include `code`, `message`, and `hint`.",
    ].join(" "),
    title: "propgate API",
    version: "1.0.0",
  },
  openapi: "3.1.0",
  paths: {
    "/health": {
      get: op(
        "getHealth",
        "Liveness",
        'Container healthcheck. Not the envelope — the body is `{ status: "ok" }` so an orchestrator can probe it without parsing propgate errors.',
        {
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    additionalProperties: false,
                    properties: { status: { type: "string" } },
                    required: ["status"],
                    type: "object",
                  },
                },
              },
              description: "The process is up.",
            },
          },
          security: [],
          tags: ["Meta"],
        }
      ),
    },
    "/openapi.json": {
      get: op(
        "getOpenApiDocument",
        "OpenAPI document",
        "This specification. CORS is open so a browser or an agent can fetch it from any origin.",
        {
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
              description: "The OpenAPI 3.1 document.",
            },
          },
          security: [],
          tags: ["Meta"],
        }
      ),
    },
    "/v1/api-keys": {
      get: op(
        "listApiKeys",
        "List API keys",
        "Your keys, oldest first, revoked ones included. Prefixes only — no endpoint returns a secret after creation. CLI: `propgate keys list`.",
        {
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "array" }) },
              },
              description: "Keys for this tenant.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["API keys"],
        }
      ),
      post: op(
        "createApiKey",
        "Create an API key",
        "The secret is returned once and never again — only its hash is stored. CLI: `propgate keys create <name>`.",
        {
          requestBody: jsonBody({
            additionalProperties: false,
            properties: {
              name: { maxLength: 64, minLength: 1, type: "string" },
            },
            required: ["name"],
            type: "object",
          }),
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "object" }) },
              },
              description: "The new key, including the secret.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "422": errorResponse(
              "Name missing or too long, or too many active keys."
            ),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["API keys"],
        }
      ),
    },
    "/v1/api-keys/{id}": {
      delete: op(
        "revokeApiKey",
        "Revoke an API key",
        "Takes effect on the next request. Revoking your last active key is refused. CLI: `propgate keys revoke <prefix|id>`.",
        {
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "object" }) },
              },
              description: "The revoked key.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "404": errorResponse("No such key on this tenant."),
            "422": errorResponse("Would revoke the last active key."),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["API keys"],
        }
      ),
    },
    "/v1/checks": {
      post: op(
        "runPublicCheck",
        "Diagnose a domain",
        "Everything propgate knows about one domain. Public, unauthenticated, rate limited by address (20/minute). Nothing is stored. The same engine as the CLI (`propgate check <domain> --remote`) and the web checker. Use this when you want a one-shot diagnosis; use POST /v1/domains/{id}/checks when you are tracking a domain against a profile.",
        {
          requestBody: jsonBody({
            additionalProperties: false,
            properties: {
              caaIssuer: { type: "string" },
              checks: {
                items: checkKind,
                minItems: 1,
                type: "array",
              },
              cnames: {
                items: {
                  additionalProperties: false,
                  properties: {
                    label: { type: "string" },
                    target: { type: "string" },
                  },
                  required: ["label", "target"],
                  type: "object",
                },
                maxItems: 5,
                type: "array",
              },
              dkimSelectors: {
                items: { type: "string" },
                maxItems: 10,
                type: "array",
              },
              domain: {
                description:
                  "The name to diagnose. Must have two labels and not be a public suffix.",
                type: "string",
              },
              expectsMail: { type: "boolean" },
              ownership: {
                items: {
                  additionalProperties: false,
                  properties: {
                    label: { type: "string" },
                    token: { type: "string" },
                  },
                  required: ["token"],
                  type: "object",
                },
                maxItems: 5,
                type: "array",
              },
              spfInclude: { type: "string" },
              spfIp: { type: "string" },
            },
            required: ["domain"],
            type: "object",
          }),
          responses: {
            "200": {
              content: { "application/json": { schema: envelope(check) } },
              description:
                "The diagnosis. meta.resolver is the address:port that was asked.",
            },
            "422": errorResponse(
              "Body failed validation, or the domain is not checkable."
            ),
            "429": errorResponse(
              "More than 20 checks in a minute from this address."
            ),
          },
          security: [],
          tags: ["Checks"],
        }
      ),
    },
    "/v1/domains": {
      get: op(
        "listDomains",
        "List domains",
        "Your domains, oldest first. Cursor paging, filterable by state and by your own external id. CLI: `propgate domains list`.",
        {
          parameters: [
            {
              in: "query",
              name: "cursor",
              schema: { type: "string" },
            },
            {
              in: "query",
              name: "externalId",
              schema: { type: "string" },
            },
            {
              in: "query",
              name: "limit",
              schema: { default: 50, maximum: 200, type: "integer" },
            },
            {
              in: "query",
              name: "state",
              schema: domainState,
            },
          ],
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "array" }) },
              },
              description:
                "A page of domains. meta.nextCursor is null at the end.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["Domains"],
        }
      ),
      post: op(
        "registerDomain",
        "Register a domain",
        "Pin a domain to a profile, with the values that profile requires per domain. Does not touch DNS. The domain starts pending. CLI: `propgate domains add <domain>`.",
        {
          requestBody: jsonBody({
            additionalProperties: false,
            properties: {
              expectations: {
                additionalProperties: {
                  additionalProperties: { type: "string" },
                  type: "object",
                },
                description: "Values keyed by requirement key, then by field.",
                type: "object",
              },
              externalId: { type: "string" },
              name: { type: "string" },
              profile: {
                description: "Profile key, not version id.",
                type: "string",
              },
            },
            required: ["name", "profile"],
            type: "object",
          }),
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "object" }) },
              },
              description: "The registered domain, still pending.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "422": errorResponse(
              "Unknown profile, unsatisfied expectations, or a bad name."
            ),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["Domains"],
        }
      ),
    },
    "/v1/domains/{id}": {
      delete: op(
        "deleteDomain",
        "Stop tracking a domain",
        "Removes the domain from this tenant. CLI: `propgate domains delete <id>`.",
        {
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "object" }) },
              },
              description: "The deleted domain.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "404": errorResponse("No such domain."),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["Domains"],
        }
      ),
      get: op(
        "getDomain",
        "Get a domain",
        "The last known state, per-requirement results, and every lookup behind them. CLI: `propgate domains get <id>`.",
        {
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "object" }) },
              },
              description: "One domain, with lookups.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "404": errorResponse("No such domain."),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["Domains"],
        }
      ),
      patch: op(
        "updateDomain",
        "Update a domain",
        "Change the values a domain is judged against, the profile it is pinned to, or both. Resets it to pending; fires no webhook. Supply at least one of expectations or profile. CLI: `propgate domains update <id>`.",
        {
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: jsonBody({
            additionalProperties: false,
            properties: {
              expectations: {
                additionalProperties: {
                  additionalProperties: { type: "string" },
                  type: "object",
                },
                type: "object",
              },
              profile: { type: "string" },
            },
            type: "object",
          }),
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "object" }) },
              },
              description: "The updated domain, now pending.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "404": errorResponse("No such domain."),
            "422": errorResponse(
              "Nothing to change, unknown profile, or unsatisfied expectations."
            ),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["Domains"],
        }
      ),
    },
    "/v1/domains/{id}/checks": {
      post: op(
        "verifyDomain",
        "Verify a domain now",
        "Runs the profile's checks, updates state, returns a result per requirement. Rate limited at 100 verifications a minute per tenant. Continuous re-checking is the sweeper and does not use this endpoint. CLI: `propgate domains check <id>`.",
        {
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "object" }) },
              },
              description: "The domain after this check.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "404": errorResponse("No such domain."),
            "429": errorResponse(
              "Verification rate limit, or per-tenant request limit."
            ),
          },
          security: bearer,
          tags: ["Domains"],
        }
      ),
    },
    "/v1/domains/{id}/timeline": {
      get: op(
        "getDomainTimeline",
        "Domain timeline",
        "What has changed for this domain, newest first. Appended to only when an observation actually differs. CLI: `propgate domains timeline <id>`.",
        {
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
            {
              in: "query",
              name: "cursor",
              schema: { type: "string" },
            },
            {
              in: "query",
              name: "limit",
              schema: { default: 50, maximum: 200, type: "integer" },
            },
          ],
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "array" }) },
              },
              description: "Record changes, newest first.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "404": errorResponse("No such domain."),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["Domains"],
        }
      ),
    },
    "/v1/members": {
      get: op(
        "listMembers",
        "List members",
        "Who is on this account. Read-only — a member is added by proving control of a mailbox through signup. CLI: `propgate members list`.",
        {
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "array" }) },
              },
              description: "Members of this tenant.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["Members"],
        }
      ),
    },
    "/v1/profiles": {
      post: op(
        "createProfile",
        "Create a profile version",
        "Editing a profile writes a new version; it never changes an existing one. Domains pin the version they were registered against. CLI: `propgate profiles create`.",
        {
          requestBody: jsonBody({
            additionalProperties: false,
            properties: {
              key: { maxLength: 64, minLength: 1, type: "string" },
              requirements: {
                items: {
                  additionalProperties: false,
                  properties: {
                    caaIssuer: { type: "string" },
                    check: checkKind,
                    expectedPublicKey: { type: "string" },
                    expectsMail: { type: "boolean" },
                    include: { type: "string" },
                    key: { type: "string" },
                    label: { type: "string" },
                    requiredPerDomain: {
                      items: { type: "string" },
                      type: "array",
                    },
                    selector: { type: "string" },
                    target: { type: "string" },
                    token: { type: "string" },
                  },
                  required: ["check", "key"],
                  type: "object",
                },
                minItems: 1,
                type: "array",
              },
            },
            required: ["key", "requirements"],
            type: "object",
          }),
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "object" }) },
              },
              description: "The new profile version.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "422": errorResponse("The definition was refused."),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["Profiles"],
        }
      ),
    },
    "/v1/profiles/{key}": {
      get: op(
        "getProfile",
        "Get a profile",
        "The current version of a profile. CLI: `propgate profiles get <key>`.",
        {
          parameters: [
            {
              in: "path",
              name: "key",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "object" }) },
              },
              description: "The current version.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "404": errorResponse("No profile with that key."),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["Profiles"],
        }
      ),
    },
    "/v1/signup": {
      post: op(
        "startSignup",
        "Start an account",
        "Sends a six-digit code, valid ten minutes. Always answers the same way, whether or not the address is known, so this is not an oracle for who has an account. CLI: `propgate signup`.",
        {
          requestBody: jsonBody({
            additionalProperties: false,
            properties: {
              email: { type: "string" },
            },
            required: ["email"],
            type: "object",
          }),
          responses: {
            "202": {
              content: {
                "application/json": { schema: envelope({ type: "object" }) },
              },
              description: "The code is stored and the mail is on its way.",
            },
            "422": errorResponse("The address is not usable."),
            "429": errorResponse("Too many signup requests from this address."),
          },
          security: [],
          tags: ["Accounts"],
        }
      ),
    },
    "/v1/signup/confirm": {
      post: op(
        "confirmSignup",
        "Confirm the address and receive an API key",
        "The code is single-use; the key is shown once and never again. CLI: `propgate confirm`.",
        {
          requestBody: jsonBody({
            additionalProperties: false,
            properties: {
              code: {
                description: "Six digits.",
                maxLength: 6,
                minLength: 6,
                type: "string",
              },
              email: { type: "string" },
            },
            required: ["code", "email"],
            type: "object",
          }),
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "object" }) },
              },
              description: "The new key, including the secret.",
            },
            "422": errorResponse(
              "The code is invalid, expired, or already used."
            ),
            "429": errorResponse("Too many signup requests from this address."),
          },
          security: [],
          tags: ["Accounts"],
        }
      ),
    },
    "/v1/webhooks": {
      get: op(
        "listWebhooks",
        "List webhook endpoints",
        "Your endpoints. An empty events array means every event. CLI: `propgate webhooks list`.",
        {
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "array" }) },
              },
              description: "Endpoints for this tenant.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["Webhooks"],
        }
      ),
      post: op(
        "createWebhook",
        "Register a webhook endpoint",
        "Idempotent on the URL; the signing secret is returned only on the call that creates it. https only, and never a private address. CLI: `propgate webhooks create`.",
        {
          requestBody: jsonBody({
            additionalProperties: false,
            properties: {
              events: {
                description: "Omit or pass [] to receive every event.",
                items: webhookEvent,
                type: "array",
              },
              url: { type: "string" },
            },
            required: ["url"],
            type: "object",
          }),
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "object" }) },
              },
              description: "The endpoint. secret is present only when created.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "422": errorResponse("The URL was refused."),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["Webhooks"],
        }
      ),
    },
    "/v1/webhooks/{id}": {
      delete: op(
        "deleteWebhook",
        "Remove a webhook endpoint",
        "Nothing further is delivered to it. CLI: `propgate webhooks delete <id>`.",
        {
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "object" }) },
              },
              description: "The removed endpoint.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "404": errorResponse("No such webhook."),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["Webhooks"],
        }
      ),
      get: op(
        "getWebhook",
        "Get a webhook endpoint",
        "One endpoint. CLI: `propgate webhooks get <id>`.",
        {
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "object" }) },
              },
              description: "The endpoint.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "404": errorResponse("No such webhook."),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["Webhooks"],
        }
      ),
      patch: op(
        "updateWebhook",
        "Update a webhook endpoint",
        "Change which events an endpoint receives, or disable it. Both fields are optional; omitting both changes nothing. CLI: `propgate webhooks update <id>`.",
        {
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: jsonBody({
            additionalProperties: false,
            properties: {
              disabled: { type: "boolean" },
              events: { items: webhookEvent, type: "array" },
            },
            type: "object",
          }),
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "object" }) },
              },
              description: "The updated endpoint.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "404": errorResponse("No such webhook."),
            "422": errorResponse("The body was refused."),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["Webhooks"],
        }
      ),
    },
    "/v1/webhooks/{id}/deliveries": {
      get: op(
        "listWebhookDeliveries",
        "List deliveries",
        "What has been sent to this endpoint, newest first. Cursor paging, filterable by status. CLI: `propgate webhooks deliveries <id>`.",
        {
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
            {
              in: "query",
              name: "cursor",
              schema: { type: "string" },
            },
            {
              in: "query",
              name: "limit",
              schema: { default: 50, maximum: 200, type: "integer" },
            },
            {
              in: "query",
              name: "status",
              schema: {
                enum: ["delivered", "failed", "pending"],
                type: "string",
              },
            },
          ],
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "array" }) },
              },
              description: "A page of deliveries.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "404": errorResponse("No such webhook."),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["Webhooks"],
        }
      ),
    },
    "/v1/webhooks/{id}/secret": {
      post: op(
        "rotateWebhookSecret",
        "Rotate a webhook signing secret",
        "The previous secret keeps verifying for a window of up to 168 hours, so a deploy does not have to be instant. Zero expires it immediately. CLI: `propgate webhooks rotate <id>`.",
        {
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  additionalProperties: false,
                  properties: {
                    windowHours: {
                      description:
                        "How long the previous secret remains valid. 0 expires it now. Default 24, max 168.",
                      maximum: 168,
                      minimum: 0,
                      type: "integer",
                    },
                  },
                  type: "object",
                },
              },
            },
            required: false,
          },
          responses: {
            "200": {
              content: {
                "application/json": { schema: envelope({ type: "object" }) },
              },
              description:
                "The new secret. meta.previousSecretExpiresAt says when the old one dies.",
            },
            "401": errorResponse("Missing or invalid bearer token."),
            "404": errorResponse("No such webhook."),
            "422": errorResponse("windowHours out of range."),
            "429": errorResponse("Per-tenant request limit."),
          },
          security: bearer,
          tags: ["Webhooks"],
        }
      ),
    },
  },
  servers: [{ description: "Production", url: API }],
  tags: [
    { name: "Meta" },
    { name: "Checks" },
    { name: "Accounts" },
    { name: "API keys" },
    { name: "Members" },
    { name: "Profiles" },
    { name: "Domains" },
    { name: "Webhooks" },
  ],
} as const;

type HttpMethod = "delete" | "get" | "patch" | "post" | "put";

interface OpenApiOperation {
  readonly description: string;
  readonly operationId: string;
}

export function documentedOperations(): readonly {
  readonly description: string;
  readonly method: string;
  readonly operationId: string;
  readonly path: string;
}[] {
  const operations: {
    description: string;
    method: string;
    operationId: string;
    path: string;
  }[] = [];

  for (const [path, item] of Object.entries(openApiDocument.paths)) {
    const methods = item as Partial<Record<HttpMethod, OpenApiOperation>>;

    for (const method of ["get", "post", "put", "patch", "delete"] as const) {
      const operation = methods[method];

      if (operation === undefined) {
        continue;
      }

      operations.push({
        description: operation.description,
        method: method.toUpperCase(),
        operationId: operation.operationId,
        path,
      });
    }
  }

  return operations;
}

export function openApiPathToHono(path: string): string {
  return path.replaceAll(/\{([^}]+)\}/g, ":$1");
}
