/**
 * Mirrors `apps/api/src/routes/domains.ts` and
 * `packages/cli/src/commands/domains.ts` exactly, so the cURL and the CLI tab
 * describe the same request. The response shapes are read off `DomainRow` and the
 * route's `serialise`, not a captured run — registering a real domain needs a
 * live tenant.
 */

export const ADD_CURL = `curl -X POST https://api.propgate.dev/v1/domains \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H "content-type: application/json" \\
  -d '{"name":"yourdomain.dev","profile":"sending"}'`;

export const ADD_CLI =
  "npx @propgate/cli domains add yourdomain.dev --profile sending";

export const ADD_EXPECT_CURL = `curl -X POST https://api.propgate.dev/v1/domains \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H "content-type: application/json" -d '{
    "name": "yourdomain.dev",
    "profile": "sending",
    "expectations": {
      "dkim": { "expectedPublicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A..." }
    }
  }'`;

export const ADD_EXPECT_CLI = `npx @propgate/cli domains add yourdomain.dev --profile sending \\
  --expect dkim.expectedPublicKey=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...`;

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

export const LIST_PAGED = `# one page, then continue where it left off
propgate domains list --limit 200 --cursor 019fcf4f-...

# or walk to the end in one command
propgate domains list --all --json`;

export const GET_CLI =
  "propgate domains get 019fcf4f-2b3c-7d4e-9f5a-6b7c8d9e0f1a";

export const GET_OUTPUT = `yourdomain.dev  failed

  id            019fcf4f-2b3c-7d4e-9f5a-6b7c8d9e0f1a
  external id   cust_1
  registered    2026-08-01 09:30
  last checked  2026-08-04 22:10
  verdict       fail

  ok   ns     pass
  ok   spf    pass
   x   dkim   fail
  ok   dmarc  warn
   x   mail   fail`;

export const CHECK_CLI =
  "propgate domains check 019fcf4f-2b3c-7d4e-9f5a-6b7c8d9e0f1a";

export const TIMELINE_CLI =
  "propgate domains timeline 019fcf4f-2b3c-7d4e-9f5a-6b7c8d9e0f1a --limit 5";

export const TIMELINE_OUTPUT = `2026-08-04 22:10  spf   v=spf1 -all → v=spf1 include:_spf.google.com -all
2026-08-01 11:04  dkim  — → k=rsa; p=MIGfMA0GCSq...`;

export const TIMELINE_EMPTY =
  "Nothing has changed. Only differences are recorded, not checks.";

export const DELETE_CLI =
  "propgate domains delete 019fcf4f-2b3c-7d4e-9f5a-6b7c8d9e0f1a";

export const REDIRECT = `$ propgate check 019fcf4f-2b3c-7d4e-9f5a-6b7c8d9e0f1a
propgate: that looks like a domain id, not a domain name.
Did you mean \`propgate domains check 019fcf4f-2b3c-7d4e-9f5a-6b7c8d9e0f1a\`?`;
