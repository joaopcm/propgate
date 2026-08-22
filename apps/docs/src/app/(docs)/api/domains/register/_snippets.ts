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

export const REGISTER_SDK = `const { data, error, meta } = await propgate.domains.create({
  name: "yourdomain.dev",
  profile: "sending",
  externalId: "cust_1",
  expectations: {
    dkim: { expectedPublicKey: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A..." },
  },
});

meta?.created;`;
