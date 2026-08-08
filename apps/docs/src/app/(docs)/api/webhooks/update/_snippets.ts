/**
 * Shapes from `apps/api/src/routes/webhooks.ts` — its zod schema for the
 * request, its `serialise` function for the response.
 */

export const UPDATE_CURL = `curl -s -X PATCH https://api.propgate.dev/v1/webhooks/019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' \\
  -d '{"disabled":true}'`;

export const UPDATE_RESPONSE = `{
  "data": {
    "createdAt": "2026-08-03T12:00:00.000Z",
    "disabled": true,
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

/**
 * The SDK calls assume a client constructed once, as `/sdk` shows:
 * `const propgate = new Propgate(process.env.PROPGATE_API_KEY)`. Every method
 * name and shape here is checked against `@propgate/sdk` itself by
 * `src/lib/sdk.spec.ts`, so a renamed method fails rather than shipping.
 */

export const UPDATE_SDK = `const { data } = await propgate.webhooks.update("019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b", {
  disabled: true,
});`;
