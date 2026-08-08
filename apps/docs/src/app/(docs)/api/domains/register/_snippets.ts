/**
 * The curl and CLI commands are quoted from QUICKSTART.md (`REGISTER_CURL` /
 * `REGISTER_CLI` in `apps/docs/src/app/(docs)/quickstart/_snippets.ts`) — real
 * commands run against the live API. QUICKSTART.md moves straight into the
 * check response and never prints the register response on its own, so the
 * response below is a shape read off `serialise` in
 * `apps/api/src/routes/domains.ts`, before the first check has run.
 */

export const REGISTER_CURL = `curl -s -X POST https://api.propgate.dev/v1/domains \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' -d '{
    "name": "yourdomain.dev",
    "profile": "sending",
    "externalId": "cust_1",
    "expectations": {
      "dkim": { "expectedPublicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A..." }
    }
  }'`;

export const REGISTER_CLI =
  "npx @propgate/cli domains add yourdomain.dev --profile sending --external-id cust_1 \\\n  --expect dkim.expectedPublicKey=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...";

export const REGISTER_RESPONSE = `{
  "data": {
    "createdAt": "2026-08-03T12:00:00.000Z",
    "expectations": {
      "dkim": { "expectedPublicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A..." }
    },
    "expectationsFingerprint": null,
    "externalId": "cust_1",
    "id": "019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a",
    "lastCheckedAt": null,
    "name": "yourdomain.dev",
    "object": "domain",
    "profileVersionId": "019fcf6b-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
    "requirements": null,
    "requirementsMet": null,
    "requirementsTotal": null,
    "state": "pending",
    "verdict": null
  },
  "error": null,
  "meta": {
    "created": true
  }
}`;

export const REGISTER_MISSING_EXPECTATION = `{
  "data": null,
  "error": {
    "message": "profile \\"sending\\" requires expectations.dkim.expectedPublicKey, which was not supplied"
  },
  "meta": null
}`;

export const REGISTER_NAME_TAKEN = `{
  "data": null,
  "error": {
    "message": "yourdomain.dev is already registered as 019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a"
  },
  "meta": null
}`;

/**
 * The SDK calls assume a client constructed once, as `/sdk` shows:
 * `const propgate = new Propgate(process.env.PROPGATE_API_KEY)`. Every method
 * name and shape here is checked against `@propgate/sdk` itself by
 * `src/lib/sdk.spec.ts`, so a renamed method fails rather than shipping.
 */

export const REGISTER_SDK = `const { data, error, meta } = await propgate.domains.create({
  name: "yourdomain.dev",
  profile: "sending",
  externalId: "cust_1",
  expectations: {
    dkim: { expectedPublicKey: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A..." },
  },
});

// False means this external id was already registered, and nothing was written.
meta?.created;`;
