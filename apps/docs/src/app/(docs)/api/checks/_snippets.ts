/**
 * `POST /v1/checks`, the public checker's endpoint.
 *
 * The response is trimmed to one check and one finding. The real answer carries
 * all six checks and every lookup behind each of them, which is several hundred
 * lines and makes the shape harder to see rather than easier.
 */

export const CHECKS_CURL = `curl -s -X POST https://api.propgate.dev/v1/checks \\
  -H 'content-type: application/json' \\
  -d '{"domain":"example.com","checks":["spf"],"spfInclude":"_spf.google.com"}'`;

export const CHECKS_CLI =
  "npx @propgate/cli check example.com --remote --only spf --spf-include _spf.google.com";

export const CHECKS_RESPONSE = `{
  "data": {
    "object": "check",
    "domain": "example.com",
    "verdict": "fail",
    "elapsedMs": 214,
    "findings": [
      {
        "code": "SPF_SOURCE_NOT_AUTHORIZED",
        "slug": "spf-source-not-authorized",
        "severity": "error",
        "summary": "This domain's SPF record does not authorise the sending service being set up, so its messages will fail SPF.",
        "evidence": {
          "detail": "add include:_spf.google.com before the all mechanism; added after it, the term never runs",
          "observed": "no include: or redirect= terms at all",
          "expected": "include:_spf.google.com"
        }
      }
    ],
    "checks": [
      {
        "kind": "spf",
        "verdict": "fail",
        "findings": ["…"],
        "lookups": [
          {
            "name": "example.com",
            "type": 16,
            "purpose": "the domain's SPF record",
            "server": "10.10.0.10:53",
            "status": "answered"
          }
        ]
      }
    ]
  },
  "error": null,
  "meta": { "resolver": "10.10.0.10:53" }
}`;

export const CHECKS_RATE_LIMITED = `HTTP/1.1 429 Too Many Requests
retry-after: 43

{"data":null,"error":{"message":"too many checks; try again in 43s"},"meta":null}`;

/**
 * The SDK calls assume a client constructed once, as `/sdk` shows:
 * `const propgate = new Propgate(process.env.PROPGATE_API_KEY)`. Every method
 * name and shape here is checked against `@propgate/sdk` itself by
 * `src/lib/sdk.spec.ts`, so a renamed method fails rather than shipping.
 */

export const CHECKS_SDK = `const { data, error } = await propgate.checks.run({
  domain: "example.com",
  checks: ["spf"],
  spfInclude: "_spf.google.com",
});`;
