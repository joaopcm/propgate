/**
 * Shapes read off `apps/api/src/routes/profiles.ts` (`serialise`) and
 * `apps/api/src/profiles/compile.ts` (`rejectDefinition`), not captured runs —
 * the page marks that with a `Callout` where they appear. The rejection
 * message is copied verbatim from `rejectDefinition`.
 */

export const PROFILE_CREATE_CURL = `curl -s -X POST https://api.propgate.dev/v1/profiles \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' -d '{
    "key": "sending",
    "requirements": [
      { "key": "spf", "check": "spf", "include": "_spf.google.com" },
      { "key": "dkim", "check": "dkim", "selector": "google" },
      { "key": "dmarc", "check": "dmarc" }
    ]
  }'`;

export const PROFILE_CREATE_CLI = `npx @propgate/cli profiles create --key sending \\
  --require 'spf:spf:include=_spf.google.com' \\
  --require 'dkim:dkim:selector=google' \\
  --require 'dmarc:dmarc'`;

export const PROFILE_CREATE_RESPONSE = `{
  "data": {
    "object": "profile",
    "id": "019fbf10-...",
    "key": "sending",
    "version": 1,
    "requirements": [
      {
        "key": "spf",
        "check": "spf",
        "include": "_spf.google.com"
      },
      {
        "key": "dkim",
        "check": "dkim",
        "selector": "google"
      },
      {
        "key": "dmarc",
        "check": "dmarc"
      }
    ]
  },
  "error": null,
  "meta": null
}`;

export const PROFILE_EDIT_CURL = `curl -s -X POST https://api.propgate.dev/v1/profiles \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' -d '{
    "key": "sending",
    "requirements": [
      { "key": "spf", "check": "spf", "include": "_spf.google.com" },
      { "key": "dkim", "check": "dkim", "selector": "google" },
      { "key": "dmarc", "check": "dmarc" },
      { "key": "mail", "check": "mx", "expectsMail": true }
    ]
  }'`;

export const PROFILE_EDIT_RESPONSE = `{
  "data": {
    "object": "profile",
    "id": "019fbf22-...",
    "key": "sending",
    "version": 2,
    "requirements": [
      {
        "key": "spf",
        "check": "spf",
        "include": "_spf.google.com"
      },
      {
        "key": "dkim",
        "check": "dkim",
        "selector": "google"
      },
      {
        "key": "dmarc",
        "check": "dmarc"
      },
      {
        "key": "mail",
        "check": "mx",
        "expectsMail": true
      }
    ]
  },
  "error": null,
  "meta": null
}`;

export const PROFILE_REJECTED_CURL = `curl -s -X POST https://api.propgate.dev/v1/profiles \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' -d '{
    "key": "sending",
    "requirements": [
      { "key": "spf", "check": "spf" },
      { "key": "spf", "check": "dmarc" }
    ]
  }'`;

export const PROFILE_REJECTED_RESPONSE = `{
  "data": null,
  "error": {
    "message": "duplicate requirement key \\"spf\\""
  },
  "meta": null
}`;

export const PROFILE_PER_DOMAIN_CURL = `curl -s -X POST https://api.propgate.dev/v1/profiles \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' -d '{
    "key": "sending",
    "requirements": [
      { "key": "spf", "check": "spf", "include": "_spf.google.com" },
      {
        "key": "dkim",
        "check": "dkim",
        "selector": "google",
        "requiredPerDomain": ["expectedPublicKey"]
      }
    ]
  }'`;

export const DOMAIN_EXPECTATIONS_CURL = `curl -s -X POST https://api.propgate.dev/v1/domains \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' -d '{
    "name": "acme.com",
    "profile": "sending",
    "expectations": {
      "dkim": { "expectedPublicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A..." }
    }
  }'`;

export const DOMAIN_EXPECTATIONS_MISSING = `{
  "data": null,
  "error": {
    "message": "profile \\"sending\\" requires expectations.dkim.expectedPublicKey, which was not supplied"
  },
  "meta": null
}`;
