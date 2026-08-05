/**
 * Every string here started as a real command run against the live API while
 * writing this page. Three kinds of adaptation were made on top of that, and
 * each is marked where it appears:
 *
 * - `SIGNUP_CURL`/`SIGNUP_CLI`/`CONFIRM_CURL`/`CONFIRM_CLI`: the confirm step
 *   ends in a mailbox, not a terminal, so those two calls (and the JSON
 *   bodies shown beside them) are shapes read off
 *   `apps/api/src/routes/signup.ts` rather than a captured run.
 * - `VERIFY_CURL`: the real run looked up the domain id with a shell
 *   one-liner piped through `python3`; here the id is inlined directly, the
 *   same one used throughout the API reference, so the call needs nothing
 *   beyond a domain id and a key.
 * - Every command uses a literal placeholder for the base URL and the key
 *   rather than a shell variable, so a reader can run each line on its own
 *   without an `export` step first.
 */

export const CHECK_CURL = `curl -s -X POST https://api.propgate.dev/v1/checks \\
  -H 'content-type: application/json' \\
  -d '{"domain":"example.com"}'`;

export const CHECK_CLI = "npx @propgate/cli check example.com";

export const SIGNUP_CURL = `curl -s -X POST https://api.propgate.dev/v1/signup \\
  -H 'content-type: application/json' \\
  -d '{"email":"you@example.com"}'`;

export const SIGNUP_CLI = "npx @propgate/cli signup --email you@example.com";

export const CONFIRM_CURL = `curl -s -X POST https://api.propgate.dev/v1/signup/confirm \\
  -H 'content-type: application/json' \\
  -d '{"email":"you@example.com","code":"123456"}'`;

export const CONFIRM_CLI =
  "npx @propgate/cli confirm --email you@example.com --code 123456";

export const PROFILE_CURL = `curl -s -X POST https://api.propgate.dev/v1/profiles \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' -d '{
    "key": "sending",
    "requirements": [
      { "key": "ns", "check": "delegation" },
      { "key": "spf", "check": "spf", "include": "_spf.google.com" },
      { "key": "dkim", "check": "dkim", "selector": "google" },
      { "key": "dmarc", "check": "dmarc" },
      { "key": "mail", "check": "mx", "expectsMail": true }
    ]
  }'`;

export const REGISTER_CURL = `curl -s -X POST https://api.propgate.dev/v1/domains \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' \\
  -d '{"name":"yourdomain.dev","profile":"sending","externalId":"cust_1"}'`;

export const REGISTER_CLI =
  "npx @propgate/cli domains add yourdomain.dev --profile sending --external-id cust_1";

export const VERIFY_CURL = `curl -s -X POST https://api.propgate.dev/v1/domains/019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a/checks \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const VERIFY_RESPONSE = `{
  "state": "failed",
  "verdict": "fail",
  "requirementsMet": 3,
  "requirementsTotal": 5,
  "requirements": [
    {
      "key": "spf",
      "satisfied": true,
      "verdict": "pass",
      "findings": []
    },
    {
      "key": "dkim",
      "satisfied": false,
      "verdict": "fail",
      "findings": [
        {
          "code": "DKIM_RECORD_MISSING",
          "name": "google._domainkey.yourdomain.dev"
        }
      ]
    }
  ]
}`;
