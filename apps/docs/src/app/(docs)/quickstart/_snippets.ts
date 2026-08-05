/**
 * Every string here is a real command run against the live API while writing
 * this page, except `SIGNUP_CURL`/`SIGNUP_CLI`/`CONFIRM_CURL`/`CONFIRM_CLI`:
 * the confirm step ends in a mailbox, not a terminal, so those two calls (and
 * the JSON bodies shown beside them in the page) are shapes read off
 * `apps/api/src/routes/signup.ts` rather than a captured run. The page marks
 * that with a `Callout` where they appear.
 */

export const CHECK_CURL = `curl -s -X POST $A/v1/checks -H 'content-type: application/json' \\
  -d '{"domain":"example.com"}' | j`;

export const CHECK_CLI = "npx @propgate/cli check example.com";

export const SIGNUP_CURL = `curl -s -X POST $A/v1/signup -H 'content-type: application/json' \\
  -d '{"email":"you@example.com"}' | j`;

export const SIGNUP_CLI = "npx @propgate/cli signup --email you@example.com";

export const CONFIRM_CURL = `curl -s -X POST $A/v1/signup/confirm -H 'content-type: application/json' \\
  -d '{"email":"you@example.com","code":"123456"}' | j`;

export const CONFIRM_CLI =
  "npx @propgate/cli confirm --email you@example.com --code 123456";

export const PROFILE_CURL = `curl -s -X POST $A/v1/profiles -H "authorization: Bearer $KEY" \\
  -H 'content-type: application/json' -d '{
    "key": "sending",
    "requirements": [
      { "key": "ns",    "check": "delegation" },
      { "key": "spf",   "check": "spf", "include": "_spf.google.com" },
      { "key": "dkim",  "check": "dkim", "selector": "google" },
      { "key": "dmarc", "check": "dmarc" },
      { "key": "mail",  "check": "mx", "expectsMail": true }
    ]
  }' | j`;

export const REGISTER_CURL = `curl -s -X POST $A/v1/domains -H "authorization: Bearer $KEY" \\
  -H 'content-type: application/json' \\
  -d '{"name":"yourdomain.dev","profile":"sending","externalId":"cust_1"}' | j`;

export const REGISTER_CLI =
  "npx @propgate/cli domains add yourdomain.dev --profile sending --external-id cust_1";

export const VERIFY_CURL = `export ID=$(curl -s "$A/v1/domains?externalId=cust_1" -H "authorization: Bearer $KEY" \\
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"][0]["id"])')

curl -s -X POST $A/v1/domains/$ID/checks -H "authorization: Bearer $KEY" | j`;

export const VERIFY_RESPONSE = `{
  "state": "failed",
  "verdict": "fail",
  "requirementsMet": 3,
  "requirementsTotal": 5,
  "requirements": [
    { "key": "spf",  "satisfied": true,  "verdict": "pass", "findings": [] },
    { "key": "dkim", "satisfied": false, "verdict": "fail",
      "findings": [
        { "code": "DKIM_RECORD_MISSING",
          "name": "google._domainkey.yourdomain.dev" }
      ] }
  ]
}`;
