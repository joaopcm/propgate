/**
 * `LIST_CURL`/`LIST_CLI` and `LIST_RESPONSE` are shapes read off
 * `apps/api/src/routes/api-keys.ts` (the `GET /` handler and `serialise`),
 * not a captured run.
 */

export const LIST_CURL = `curl -s https://api.propgate.dev/v1/api-keys \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const LIST_CLI = "propgate keys list";

export const LIST_RESPONSE = `{
  "data": [
    {
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
    {
      "createdAt": "2026-08-05T14:02:11.000Z",
      "createdBy": "you@example.com",
      "id": "019fcf6b-...",
      "lastUsedAt": "2026-08-05T15:40:02.000Z",
      "name": "staging",
      "object": "api_key",
      "prefix": "pg_live_9f2a",
      "revoked": false,
      "revokedAt": null
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

export const LIST_SDK = "const { data } = await propgate.apiKeys.list();";
