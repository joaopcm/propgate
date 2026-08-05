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
