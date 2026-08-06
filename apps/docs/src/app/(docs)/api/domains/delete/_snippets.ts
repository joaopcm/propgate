/**
 * The request is quoted verbatim from QUICKSTART.md's "Clean up" section, a
 * real command against the live API. It pipes to a formatter without
 * printing the body, so the response is a shape read off the route handler
 * (`route.delete("/:id", ...)` in `apps/api/src/routes/domains.ts`).
 */

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
