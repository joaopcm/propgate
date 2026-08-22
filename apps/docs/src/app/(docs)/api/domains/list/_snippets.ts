export const LIST_CURL = `curl -s "https://api.propgate.dev/v1/domains?limit=200" \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
curl -s "https://api.propgate.dev/v1/domains?state=failed" \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
curl -s "https://api.propgate.dev/v1/domains?externalId=cust_1" \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const LIST_CLI = "npx @propgate/cli domains list --state failed";

export const LIST_RESPONSE = `{
  "data": [
    {
      "createdAt": "2026-08-03T12:00:00.000Z",
      "externalId": "cust_1",
      "id": "019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a",
      "lastCheckedAt": "2026-08-03T12:05:00.000Z",
      "name": "yourdomain.dev",
      "object": "domain",
      "profileVersionId": "019fcf6b-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
      "requirements": [
        {
          "key": "spf",
          "satisfied": true,
          "verdict": "pass",
          "findings": []
        }
      ],
      "requirementsMet": 3,
      "requirementsTotal": 5,
      "state": "failed",
      "verdict": "fail"
    }
  ],
  "error": null,
  "meta": {
    "nextCursor": "019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a"
  }
}`;

export const LIST_SDK = `const page = await propgate.domains.list({ state: "failed" });

page.meta?.nextCursor;

const { data, error } = await propgate.domains.listAll({ state: "failed" });`;
