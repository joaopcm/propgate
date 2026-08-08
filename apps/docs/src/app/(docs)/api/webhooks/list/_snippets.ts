/**
 * Shapes from `serialise` in `apps/api/src/routes/webhooks.ts`.
 */

export const LIST_CURL = `curl -s https://api.propgate.dev/v1/webhooks \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const LIST_RESPONSE = `{
  "data": [
    {
      "createdAt": "2026-08-03T12:00:00.000Z",
      "disabled": false,
      "events": [
        "domain.failed",
        "domain.recovered"
      ],
      "id": "019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b",
      "object": "webhook",
      "url": "https://example.com/hooks/propgate"
    }
  ],
  "error": null,
  "meta": null
}`;

/**
 * The SDK calls assume a client constructed once, as `/sdk` shows:
 * `const propgate = new Propgate(process.env.PROPGATE_API_KEY)`. Every method
 * name and shape here is checked against `@propgate/sdk` itself by
 * `src/lib/sdk.spec.ts`, so a renamed method fails rather than shipping.
 */

export const LIST_SDK = "const { data } = await propgate.webhooks.list();";
