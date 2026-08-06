/**
 * Neither the request nor the response for this endpoint is captured in
 * QUICKSTART.md — it does not call `GET /v1/profiles/:key`. The curl is the
 * predictable counterpart of the register call there; the response is a
 * shape read off `serialise` in `apps/api/src/routes/profiles.ts`. The page
 * marks both with a `Callout`.
 */

export const PROFILE_GET_CURL = `curl -s https://api.propgate.dev/v1/profiles/sending \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const PROFILE_GET_RESPONSE = `{
  "data": {
    "id": "019fcf6b-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
    "key": "sending",
    "object": "profile",
    "requirements": [
      {
        "key": "ns",
        "check": "delegation"
      },
      {
        "key": "spf",
        "check": "spf",
        "include": "_spf.google.com"
      },
      {
        "key": "dkim",
        "check": "dkim",
        "selector": "google"
      },
      {
        "key": "dmarc",
        "check": "dmarc"
      },
      {
        "key": "mail",
        "check": "mx",
        "expectsMail": true
      }
    ],
    "version": 2
  },
  "error": null,
  "meta": null
}`;

export const PROFILE_GET_NOT_FOUND = `{
  "data": null,
  "error": {
    "message": "no profile named \\"sending\\""
  },
  "meta": null
}`;
