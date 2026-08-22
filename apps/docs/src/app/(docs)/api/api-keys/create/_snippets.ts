export const CREATE_CURL = `curl -s -X POST https://api.propgate.dev/v1/api-keys \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H "content-type: application/json" \\
  -d '{"name":"staging"}'`;

export const CREATE_CLI = "propgate keys create staging";

export const CREATE_RESPONSE = `{
  "data": {
    "key": "pg_live_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",
    "createdAt": "2026-08-05T14:02:11.000Z",
    "createdBy": "you@example.com",
    "id": "019fcf6b-...",
    "lastUsedAt": null,
    "name": "staging",
    "object": "api_key",
    "prefix": "pg_live_9f2a",
    "revoked": false,
    "revokedAt": null
  },
  "error": null,
  "meta": null
}`;

export const CREATE_MISSING_NAME_422 = `{
  "data": null,
  "error": {
    "message": "name: Invalid input: expected string, received undefined"
  },
  "meta": null
}`;

export const CREATE_LIMIT_422 = `{
  "data": null,
  "error": {
    "message": "active key limit of 50 reached, and you hold 50; revoke one before creating another"
  },
  "meta": null
}`;

export const CREATE_SDK = `const { data, error } = await propgate.apiKeys.create({ name: "staging" });

console.log(data?.key);`;
