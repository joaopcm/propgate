/**
 * `REVOKE_CURL`/`REVOKE_CLI` and every response below are shapes read off
 * `apps/api/src/routes/api-keys.ts` (the `DELETE /:id` handler and
 * `serialise`), not a captured run. The 404, the 409 and the "already
 * revoked" meta message are copied verbatim from the route.
 */

export const REVOKE_CURL = `curl -s -X DELETE https://api.propgate.dev/v1/api-keys/019fcb02-... \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const REVOKE_CLI = "propgate keys revoke pg_live_7c1d";

export const REVOKE_RESPONSE = `{
  "data": {
    "createdAt": "2026-08-01T09:12:44.000Z",
    "createdBy": "you@example.com",
    "id": "019fcb02-...",
    "lastUsedAt": "2026-08-04T11:02:00.000Z",
    "name": "onboarding",
    "object": "api_key",
    "prefix": "pg_live_7c1d",
    "revoked": true,
    "revokedAt": "2026-08-05T14:03:00.000Z"
  },
  "error": null,
  "meta": {
    "alreadyRevoked": false
  }
}`;

export const REVOKE_ALREADY_RESPONSE = `{
  "data": {
    "...": "..."
  },
  "error": null,
  "meta": {
    "alreadyRevoked": true
  }
}`;

export const REVOKE_NOT_FOUND_404 = `{
  "data": null,
  "error": {
    "message": "no such api key"
  },
  "meta": null
}`;

export const REVOKE_LAST_ACTIVE_409 = `{
  "data": null,
  "error": {
    "message": "this is your last active api key; revoking it would lock you out of this API and there is no un-revoke. Create a replacement first."
  },
  "meta": null
}`;
