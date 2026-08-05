/**
 * The curl and CLI commands are quoted from QUICKSTART.md (`REGISTER_CURL` /
 * `REGISTER_CLI` in `apps/docs/src/app/(docs)/quickstart/_snippets.ts`) — real
 * commands run against the live API. QUICKSTART.md moves straight into the
 * check response and never prints the register response on its own, so the
 * response below is a shape read off `serialise` in
 * `apps/api/src/routes/domains.ts`, before the first check has run.
 */

export const REGISTER_CURL = `curl -s -X POST $A/v1/domains -H "authorization: Bearer $KEY" \\
  -H 'content-type: application/json' \\
  -d '{"name":"yourdomain.dev","profile":"sending","externalId":"cust_1"}' | j`;

export const REGISTER_CLI =
  "npx @propgate/cli domains add yourdomain.dev --profile sending --external-id cust_1";

export const REGISTER_RESPONSE = `{
  "data": {
    "createdAt": "2026-08-03T12:00:00.000Z",
    "externalId": "cust_1",
    "id": "019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a",
    "lastCheckedAt": null,
    "name": "yourdomain.dev",
    "object": "domain",
    "profileVersionId": "019fcf6b-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
    "requirements": null,
    "requirementsMet": null,
    "requirementsTotal": null,
    "state": "pending",
    "verdict": null
  },
  "error": null,
  "meta": { "created": true }
}`;

export const REGISTER_NAME_TAKEN = `{
  "data": null,
  "error": {
    "message": "yourdomain.dev is already registered as 019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a"
  },
  "meta": null
}`;
