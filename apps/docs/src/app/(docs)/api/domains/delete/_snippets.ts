export const DELETE_CURL = `curl -s -X DELETE https://api.propgate.dev/v1/domains/019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const DELETE_RESPONSE = `{
  "data": {
    "deleted": true,
    "id": "019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a"
  },
  "error": null,
  "meta": null
}`;

export const DELETE_NOT_FOUND = `{
  "data": null,
  "error": {
    "message": "no such domain"
  },
  "meta": null
}`;

export const DELETE_SDK = `const { data, error } = await propgate.domains.remove("019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a");`;
