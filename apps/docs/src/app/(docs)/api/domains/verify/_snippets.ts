/**
 * Both the request and the response are quoted verbatim from QUICKSTART.md —
 * a real run against the live API. QUICKSTART.md trims the requirements
 * array to two of the five entries in the profile it registers against, so
 * `requirementsTotal: 5` and only two items appearing is the source
 * document, not a mistake introduced here.
 */

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

/**
 * The message template is quoted verbatim from `apps/api/src/routes/domains.ts`
 * (`route.post("/:id/checks", ...)`), not a captured 429 — provoking one on the
 * live fixture tier isn't something QUICKSTART.md does.
 */
export const VERIFY_RATE_LIMITED = `HTTP/1.1 429 Too Many Requests
Retry-After: 41

{
  "data": null,
  "error": { "message": "rate limit of 100 checks per minute exceeded; try again in 41s" },
  "meta": null
}`;
