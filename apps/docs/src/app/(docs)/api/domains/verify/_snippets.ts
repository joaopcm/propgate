/**
 * The response is quoted verbatim from QUICKSTART.md — a real run against
 * the live API. QUICKSTART.md trims the requirements array to two of the
 * five entries in the profile it registers against, so
 * `requirementsTotal: 5` and only two items appearing is the source
 * document, not a mistake introduced here.
 *
 * The request is adapted rather than verbatim. QUICKSTART.md captures the id
 * lookup as a shell one-liner piped through `python3` to pull it out of the
 * registration response — real, but not a shape a reader should have to
 * retype. Here the id is inlined directly, the same one used throughout the
 * domains reference, so the call needs nothing beyond a domain id and a key.
 */
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

/**
 * The message template is quoted verbatim from `apps/api/src/routes/domains.ts`
 * (`route.post("/:id/checks", ...)`), not a captured 429 — provoking one on the
 * live fixture tier isn't something QUICKSTART.md does.
 */
export const VERIFY_RATE_LIMITED = `HTTP/1.1 429 Too Many Requests
Retry-After: 41

{
  "data": null,
  "error": {
    "message": "rate limit of 100 checks per minute exceeded; try again in 41s"
  },
  "meta": null
}`;
