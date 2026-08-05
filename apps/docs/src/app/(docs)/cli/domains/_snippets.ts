/**
 * `ADD_*` and `LIST_*` mirror `apps/api/src/routes/domains.ts` (`POST /v1/domains`,
 * `GET /v1/domains`) and `packages/cli/src/account.ts` (`domainsAdd`, `domainsList`)
 * exactly, so the cURL and the CLI tab describe the same request. The response
 * shapes are read off `DomainRow` in `account.ts` and the route's `serialise`,
 * not a captured run — registering a real domain needs a live tenant.
 */

export const ADD_CURL = `curl -X POST https://api.propgate.dev/v1/domains \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H "content-type: application/json" \\
  -d '{"name":"yourdomain.dev","profile":"sending"}'`;

export const ADD_CLI =
  "npx @propgate/cli domains add yourdomain.dev --profile sending";

export const ADD_OUTPUT = `yourdomain.dev registered as 019fcf4f-....

Nothing has been checked yet — the sweeper will pick it up.`;

/**
 * `state` is one of the five values `domain_state` defines
 * (`packages/db/src/schema/domains.ts`): `pending`, `verifying`, `verified`,
 * `degraded`, `failed`. The CLI passes it straight through as a query string.
 */
export const LIST_CURL = `curl "https://api.propgate.dev/v1/domains?state=failed" \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const LIST_CLI = "npx @propgate/cli domains list --state failed";

export const LIST_OUTPUT = `failed      yourdomain.dev              3/5           checked 2026-08-04 22:10
failed      other.example                0/4           checked 2026-08-05 01:02`;

export const LIST_EMPTY_OUTPUT =
  "No domains yet. Add one with `propgate domains add <domain> --profile <key>`.";
