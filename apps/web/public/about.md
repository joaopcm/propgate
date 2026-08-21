# About propgate

propgate is domain verification infrastructure for products whose customers have to configure DNS. Email platforms, custom-domain dashboards, anything with a “verify your domain” screen: they all rebuild the same brittle checker, then spend years discovering provider quirks that a regex over a TXT record cannot see.

This is that checker, as a library, a CLI, a public web page, and an API. It expands SPF the way an MTA would, with the ten-lookup and two-void-lookup limits counted. It parses DKIM keys. It climbs the CAA tree per RFC 8659. It asks every nameserver in the delegation and reports when they disagree. It distinguishes a domain that is broken from a lookup that timed out, because collapsing those two is how a monitoring product pages someone at 3am over its own bad second.

The public checker on this site stores nothing. You type a domain, we ask live DNS, we return findings with the queries behind them, and that is the whole transaction. Teams that need to remember domains — pin them to a profile of requirements, re-check them, fire a webhook when one fails — use the API at api.propgate.dev, the Node SDK, or the CLI.

The DNS library and the SDKs are MIT licensed. The source is at https://github.com/joaopcm/propgate. RFC conformance is published at https://docs.propgate.dev/conformance: which normative statements a verifier implements, which it does not, and which test asserts each one.

## Where to go next

- [propgate.dev](https://propgate.dev) — public checker
- [Docs](https://docs.propgate.dev)
- [OpenAPI](https://propgate.dev/openapi.json)
- [Contact](https://propgate.dev/contact)
- [Privacy](https://propgate.dev/privacy)
- [GitHub](https://github.com/joaopcm/propgate)
