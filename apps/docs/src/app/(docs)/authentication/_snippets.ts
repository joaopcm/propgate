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

/**
 * The client reads `PROPGATE_API_KEY` itself, so the header never appears in
 * calling code. Shown beside the other two because "where does the key go" is
 * the question this page answers.
 */
export const AUTH_HEADER_SDK = `import { Propgate } from "@propgate/sdk";

// The argument wins; PROPGATE_API_KEY is the fallback.
const propgate = new Propgate(process.env.PROPGATE_API_KEY);

const { error } = await propgate.members.list();

error?.code; // "unauthorized" for a revoked or unknown key
// "missing_api_key" when there was no key to send, which never leaves the process`;
