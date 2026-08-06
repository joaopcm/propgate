/**
 * Shapes from the delete handler in `apps/api/src/routes/webhooks.ts`.
 */

export const DELETE_CURL = `curl -s -X DELETE https://api.propgate.dev/v1/webhooks/019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const DELETE_RESPONSE = `{
  "data": {
    "deleted": true,
    "id": "019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b"
  },
  "error": null,
  "meta": null
}`;
