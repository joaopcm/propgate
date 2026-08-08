/**
 * `MEMBERS_CURL` and `MEMBERS_RESPONSE` are shapes read off
 * `apps/api/src/routes/members.ts` (the `GET /` handler and `serialise`),
 * not a captured run.
 */

export const MEMBERS_CURL = `curl -s https://api.propgate.dev/v1/members \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const MEMBERS_RESPONSE = `{
  "data": [
    {
      "createdAt": "2026-08-01T09:12:44.000Z",
      "email": "you@example.com",
      "id": "019fcb00-...",
      "object": "member"
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

export const MEMBERS_SDK = "const { data } = await propgate.members.list();";
