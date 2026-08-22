export const CHECK_CURL = `curl -s -X POST https://api.propgate.dev/v1/checks \\
  -H 'content-type: application/json' \\
  -d '{"domain":"example.com"}'`;

export const CHECK_CLI = "npx @propgate/cli check example.com";

export const SIGNUP_CURL = `curl -s -X POST https://api.propgate.dev/v1/signup \\
  -H 'content-type: application/json' \\
  -d '{"email":"you@example.com"}'`;

export const SIGNUP_CLI = "npx @propgate/cli signup --email you@example.com";

export const CONFIRM_CURL = `curl -s -X POST https://api.propgate.dev/v1/signup/confirm \\
  -H 'content-type: application/json' \\
  -d '{"email":"you@example.com","code":"123456"}'`;

export const CONFIRM_CLI =
  "npx @propgate/cli confirm --email you@example.com --code 123456";

export const PROFILE_CURL = `curl -s -X POST https://api.propgate.dev/v1/profiles \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' -d '{
    "key": "sending",
    "requirements": [
      { "key": "ns", "check": "delegation" },
      { "key": "spf", "check": "spf", "include": "_spf.google.com" },
      { "key": "dkim", "check": "dkim", "selector": "google",
        "requiredPerDomain": ["expectedPublicKey"] },
      { "key": "dmarc", "check": "dmarc" },
      { "key": "mail", "check": "mx", "expectsMail": true }
    ]
  }'`;

export const PROFILE_CLI = `npx @propgate/cli profiles create --key sending \\
  --require 'ns:delegation' \\
  --require 'spf:spf:include=_spf.google.com' \\
  --require 'dkim:dkim:selector=google,requiredPerDomain=expectedPublicKey' \\
  --require 'dmarc:dmarc' \\
  --require 'mail:mx:expectsMail=true'`;

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

export const REGISTER_CLI = `npx @propgate/cli domains add yourdomain.dev \\
  --profile sending --external-id cust_1 \\
  --expect dkim.expectedPublicKey=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...`;

export const VERIFY_CURL = `curl -s -X POST https://api.propgate.dev/v1/domains/019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a/checks \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const VERIFY_CLI =
  "npx @propgate/cli domains check 019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a";

export const VERIFY_RESPONSE = `{
  "state": "failed",
  "verdict": "fail",
  "requirementsMet": 3,
  "requirementsTotal": 5,
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
  ]
}`;

export const CHECK_SDK = `import { Propgate } from "@propgate/sdk";

const { data } = await new Propgate().checks.run({ domain: "example.com" });`;

export const PROFILE_SDK = `const propgate = new Propgate(process.env.PROPGATE_API_KEY);

await propgate.profiles.create({
  key: "sending",
  requirements: [
    { key: "ns", check: "delegation" },
    { key: "spf", check: "spf", include: "_spf.google.com" },
    {
      key: "dkim",
      check: "dkim",
      selector: "google",
      requiredPerDomain: ["expectedPublicKey"],
    },
    { key: "dmarc", check: "dmarc" },
    { key: "mail", check: "mx", expectsMail: true },
  ],
});`;

export const REGISTER_SDK = `const { data } = await propgate.domains.create({
  name: "yourdomain.dev",
  profile: "sending",
  externalId: "cust_1",
  expectations: {
    dkim: { expectedPublicKey: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A..." },
  },
});`;

export const VERIFY_SDK = `const { data, error } = await propgate.domains.check(
  "019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a"
);

data?.requirementsMet;`;

export const READ_BACK_CURL = `curl -s https://api.propgate.dev/v1/domains/019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
curl -s https://api.propgate.dev/v1/domains/019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a/timeline \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const READ_BACK_SDK = `const { data } = await propgate.domains.get("019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a");

const timeline = await propgate.domains.timeline(
  "019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a"
);`;
