/**
 * `CREATE_CURL`/`CREATE_CLI` and `CREATE_RESPONSE` are shapes read off
 * `apps/api/src/routes/api-keys.ts` (the `POST /` handler and `serialise`),
 * not a captured run. `createdBy` shows the account's own address, because
 * a key created with an onboarding key propagates that key's attribution —
 * see the "Attribution follows the key that authenticated the request"
 * comment in the route.
 *
 * `CREATE_MISSING_NAME_422` was produced by running the real `createSchema`
 * against a missing `name` in this repo's installed zod, then passing the
 * resulting issue through `firstIssue`. `CREATE_LIMIT_422` is copied
 * verbatim from `api-keys.ts` with an illustrative count.
 */

export const CREATE_CURL = `curl -s -X POST https://api.propgate.dev/v1/api-keys \\
  -H "authorization: Bearer $KEY" \\
  -H "content-type: application/json" \\
  -d '{"name":"staging"}'`;

export const CREATE_CLI = "propgate keys create staging";

export const CREATE_RESPONSE = `{
  "data": {
    "key": "pg_live_...",
    "createdAt": "2026-08-05T14:02:11.000Z",
    "createdBy": "you@example.com",
    "id": "019fcf6b-...",
    "lastUsedAt": null,
    "name": "staging",
    "object": "api_key",
    "prefix": "pg_live_9f2a",
    "revoked": false,
    "revokedAt": null
  },
  "error": null,
  "meta": null
}`;

export const CREATE_MISSING_NAME_422 = `{ "data": null, "error": { "message": "name: Invalid input: expected string, received undefined" }, "meta": null }`;

export const CREATE_LIMIT_422 = `{ "data": null, "error": { "message": "active key limit of 50 reached, and you hold 50; revoke one before creating another" }, "meta": null }`;
