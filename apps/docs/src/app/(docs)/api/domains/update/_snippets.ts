/**
 * Shapes read off `serialise` and the `PATCH /:id` handler in
 * `apps/api/src/routes/domains.ts`, not captured runs. The rejection messages are
 * copied verbatim from `rejectExpectations` in
 * `apps/api/src/profiles/expectations.ts` and from `updateSchema`.
 */

export const UPDATE_CURL = `curl -s -X PATCH https://api.propgate.dev/v1/domains/019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' -d '{
    "expectations": {
      "dkim": { "expectedPublicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...NEW" }
    }
  }'`;

export const UPDATE_RESPONSE = `{
  "data": {
    "createdAt": "2026-08-03T12:00:00.000Z",
    "expectations": {
      "dkim": { "expectedPublicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...NEW" }
    },
    "expectationsFingerprint": "3f786850e387550fdab836ed7e6dc881de23001b...",
    "externalId": "cust_1",
    "id": "019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a",
    "lastCheckedAt": "2026-08-05T09:14:02.000Z",
    "name": "yourdomain.dev",
    "object": "domain",
    "profileVersionId": "019fcf6b-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
    "requirements": [],
    "requirementsMet": 0,
    "requirementsTotal": 0,
    "state": "pending",
    "verdict": "pass"
  },
  "error": null,
  "meta": {
    "profileVersionId": "019fcf6b-1a2b-7c3d-8e4f-5a6b7c8d9e0f"
  }
}`;

export const UPDATE_REPOINT_CURL = `curl -s -X PATCH https://api.propgate.dev/v1/domains/019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' -d '{"profile":"full-mail"}'`;

export const UPDATE_UNSATISFIED = `{
  "data": null,
  "error": {
    "message": "profile \\"full-mail\\" requires expectations.dkim-2.expectedPublicKey, which was not supplied"
  },
  "meta": null
}`;

export const UPDATE_EMPTY = `{
  "data": null,
  "error": {
    "message": "supply expectations, profile, or both"
  },
  "meta": null
}`;
