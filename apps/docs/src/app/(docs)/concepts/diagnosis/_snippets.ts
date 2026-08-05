/**
 * A shape read off `context.report` in `packages/dns/src/evaluate/dkim.ts`
 * (the `PROVIDER_APPENDED_ZONE_NAME` branch), not a captured run.
 */

export const PROVIDER_APPENDED_ZONE_NAME_FINDING = `{
  "code": "PROVIDER_APPENDED_ZONE_NAME",
  "name": "pg1._domainkey.customer.example",
  "expected": "pg1._domainkey.customer.example",
  "observed": "pg1._domainkey.customer.example.customer.example"
}`;
