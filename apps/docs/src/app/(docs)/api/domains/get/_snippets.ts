/**
 * The request is quoted verbatim from QUICKSTART.md ("Read it back, and
 * watch it change"), a real command against the live API. QUICKSTART.md
 * pipes the output straight to a formatter and never prints the body, so the
 * response is a shape read off `serialise` in `apps/api/src/routes/domains.ts`
 * with `includeLookups: true`.
 *
 * The `lookups` shape is `StoredLookup` from `packages/db/src/schema/domains.ts`
 * — a flattened record. `server` is a formatted "address:port" string, not the
 * `ServerAddress` object the resolver itself uses, and `status` is the bare
 * `QueryOutcome.status` string with the rest of the outcome (the DNS message,
 * timing) discarded before storage. Both are collapsed in
 * `storedLookups()` in `apps/api/src/domains/check.ts` on the write path.
 */

export const GET_CURL = `curl -s https://api.propgate.dev/v1/domains/019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"          # stored, no re-check`;

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

/**
 * The SDK calls assume a client constructed once, as `/sdk` shows:
 * `const propgate = new Propgate(process.env.PROPGATE_API_KEY)`. Every method
 * name and shape here is checked against `@propgate/sdk` itself by
 * `src/lib/sdk.spec.ts`, so a renamed method fails rather than shipping.
 */

export const GET_SDK = `const { data, error } = await propgate.domains.get("019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a");

// Stored, not re-checked. data.lookups is the derivation behind the verdict.
data?.lookups;`;
