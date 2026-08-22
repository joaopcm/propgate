export const GET_CURL = `curl -s https://api.propgate.dev/v1/domains/019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const GET_RESPONSE = `{
  "data": {
    "createdAt": "2026-08-03T12:00:00.000Z",
    "externalId": "cust_1",
    "id": "019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a",
    "lastCheckedAt": "2026-08-03T12:05:00.000Z",
    "lookups": [
      {
        "name": "yourdomain.dev",
        "purpose": "SPF record",
        "server": "8.8.8.8:53",
        "status": "answered",
        "type": 16
      },
      {
        "name": "google._domainkey.yourdomain.dev",
        "purpose": "expected selector",
        "server": "8.8.8.8:53",
        "status": "answered",
        "type": 16
      }
    ],
    "name": "yourdomain.dev",
    "object": "domain",
    "profileVersionId": "019fcf6b-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
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
    ],
    "requirementsMet": 3,
    "requirementsTotal": 5,
    "state": "failed",
    "verdict": "fail"
  },
  "error": null,
  "meta": null
}`;

export const GET_SDK = `const { data, error } = await propgate.domains.get("019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a");

data?.lookups;`;
