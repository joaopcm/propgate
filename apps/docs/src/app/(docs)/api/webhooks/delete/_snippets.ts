/**
 * Shapes from the delete handler in `apps/api/src/routes/webhooks.ts`.
 */

export const DELETE_CURL = `curl -s -X DELETE https://api.propgate.dev/v1/webhooks/019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const DELETE_RESPONSE = `{
  "data": {
    "deleted": true,
    "id": "019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b"
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

export const DELETE_SDK = `const { data, error } = await propgate.webhooks.remove("019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b");`;
