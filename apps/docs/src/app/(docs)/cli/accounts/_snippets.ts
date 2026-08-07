/**
 * The confirm exchange ends in a mailbox, not a terminal, so nothing past
 * `signup` can be a captured run. `SIGNUP_*` through `REVOKE_*` are shapes
 * read off `packages/cli/src/account.ts` — the request bodies, the routes,
 * and the exact strings each command prints — rather than a captured run.
 */

export const SIGNUP_CURL = `curl -X POST https://api.propgate.dev/v1/signup \\
  -H "content-type: application/json" \\
  -d '{"email":"you@example.com"}'`;

export const SIGNUP_CLI = "npx @propgate/cli signup --email you@example.com";

export const SIGNUP_OUTPUT = `If you@example.com can receive mail, a six-digit code is on its way.
It expires in ten minutes.

  propgate confirm --email you@example.com --code <code>`;

export const CONFIRM_CURL = `curl -X POST https://api.propgate.dev/v1/signup/confirm \\
  -H "content-type: application/json" \\
  -d '{"email":"you@example.com","code":"123456"}'`;

export const CONFIRM_CLI =
  "npx @propgate/cli confirm --email you@example.com --code 123456";

export const CONFIRM_OUTPUT = `Account created.

  pg_live_Ab3x...

Stored in /home/you/.config/propgate/config.json. It will not be shown again.`;

export const KEYS_LIST_CURL = `curl https://api.propgate.dev/v1/api-keys \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const KEYS_LIST_CLI = "npx @propgate/cli keys list";

export const KEYS_LIST_OUTPUT = `active   pg_live_Ab3x  ci              used 2026-08-01 09:14
REVOKED  pg_live_Qz9m  old-laptop      used never`;

export const KEYS_CREATE_CURL = `curl -X POST https://api.propgate.dev/v1/api-keys \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H "content-type: application/json" \\
  -d '{"name":"ci"}'`;

export const KEYS_CREATE_CLI = "npx @propgate/cli keys create ci";

export const KEYS_CREATE_OUTPUT = `pg_live_Ab3x...

Shown once. This does not replace your stored key.`;

/**
 * There is no endpoint that revokes by prefix — the API takes an id, because
 * a four-character prefix carries no unique index. The CLI's `revoke pg_live_Ab3x`
 * does exactly this list-then-delete underneath, which is why the cURL
 * equivalent is two calls rather than one.
 */
export const REVOKE_CURL = `curl https://api.propgate.dev/v1/api-keys \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
# find the id whose "prefix" is pg_live_Ab3x, then:
curl -X DELETE https://api.propgate.dev/v1/api-keys/019fcf4f-3e6a-71aa-9120-99d104f062ac \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const REVOKE_CLI = "npx @propgate/cli keys revoke pg_live_Ab3x";

export const REVOKE_OUTPUT =
  "Revoked pg_live_Ab3x. It stops working on the next request.";

export const REVOKE_AMBIGUOUS = `propgate: "pg_live_A" matches 2 keys. Revoke by id instead:
  019fcf4f-...  ci
  019fcf51-...  staging`;

export const MEMBERS_CLI = "propgate members list";

export const MEMBERS_OUTPUT = `you@example.com       joined 2026-08-01 09:12
colleague@example.com  joined 2026-08-03 14:40`;
