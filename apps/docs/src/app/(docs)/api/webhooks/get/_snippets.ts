/**
 * Shapes from `serialise` in `apps/api/src/routes/webhooks.ts`. The 404
 * message is copied verbatim from the same route.
 */

export const GET_CURL = `curl -s https://api.propgate.dev/v1/webhooks/019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const GET_RESPONSE = `{
  "data": {
    "createdAt": "2026-08-03T12:00:00.000Z",
    "disabled": false,
    "events": [
      "domain.failed",
      "domain.recovered"
    ],
    "id": "019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b",
    "object": "webhook",
    "url": "https://example.com/hooks/propgate"
  },
  "error": null,
  "meta": null
}`;

export const GET_NOT_FOUND = `{
  "data": null,
  "error": {
    "message": "no such webhook"
  },
  "meta": null
}`;
