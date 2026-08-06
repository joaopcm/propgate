/**
 * `SIGNUP_CURL`/`SIGNUP_CLI` are shapes read off `apps/api/src/routes/signup.ts`,
 * not a captured run — the confirm step ends in a mailbox, not a terminal. The
 * page marks that with a `Callout`. `AUTH_HEADER_CURL`/`AUTH_HEADER_CLI` and
 * `REVOKED_401`/`UNKNOWN_401` are real: the header form and both messages are
 * copied from `apps/api/src/middleware/auth.ts`.
 */

export const SIGNUP_CURL = `curl -X POST https://api.propgate.dev/v1/signup \\
  -H "content-type: application/json" \\
  -d '{"email":"you@example.com"}'

curl -X POST https://api.propgate.dev/v1/signup/confirm \\
  -H "content-type: application/json" \\
  -d '{"email":"you@example.com","code":"123456"}'`;

export const SIGNUP_CLI = `npx @propgate/cli signup  --email you@example.com
npx @propgate/cli confirm --email you@example.com --code 123456`;

export const AUTH_HEADER_CURL = `curl https://api.propgate.dev/v1/domains \\
  -H "Authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const AUTH_HEADER_CLI =
  "PROPGATE_API_KEY=pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx npx @propgate/cli domains list";

export const REVOKED_401 = `{
  "data": null,
  "error": {
    "message": "this API key has been revoked"
  },
  "meta": null
}`;

export const UNKNOWN_401 = `{
  "data": null,
  "error": {
    "message": "invalid API key"
  },
  "meta": null
}`;
