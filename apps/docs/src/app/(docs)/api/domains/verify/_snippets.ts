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

export const VERIFY_RATE_LIMITED = `HTTP/1.1 429 Too Many Requests
Retry-After: 41

{
  "data": null,
  "error": {
    "message": "rate limit of 100 checks per minute exceeded; try again in 41s"
  },
  "meta": null
}`;

export const VERIFY_SDK = `const { data, error, meta } = await propgate.domains.check("019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a");

if (error?.code === "rate_limited") {
  schedule(error.retryAfterSeconds);
}`;
