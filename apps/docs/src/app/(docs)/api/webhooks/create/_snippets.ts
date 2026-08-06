/**
 * Shapes from `apps/api/src/routes/webhooks.ts` — its zod schema for the
 * request, its `serialise` function for the response.
 */

export const CREATE_CURL = `curl -s -X POST https://api.propgate.dev/v1/webhooks \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' \\
  -d '{"url":"https://example.com/hooks/propgate","events":["domain.failed","domain.recovered"]}'`;

export const CREATE_RESPONSE = `{
  "data": {
    "createdAt": "2026-08-03T12:00:00.000Z",
    "disabled": false,
    "events": [
      "domain.failed",
      "domain.recovered"
    ],
    "id": "019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b",
    "object": "webhook",
    "secret": "whsec_...",
    "url": "https://example.com/hooks/propgate"
  },
  "error": null,
  "meta": {
    "created": true
  }
}`;

export const CREATE_REJECTED = `{
  "data": null,
  "error": {
    "message": "10.0.0.5 is a private or loopback address, which this service will not send to"
  },
  "meta": null
}`;
