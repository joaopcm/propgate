# propgate

What is actually wrong with this domain?

propgate diagnoses a domain's DNS the way a receiving mail server would: nameservers, SPF, DKIM, DMARC, mail delivery, and certificate authorities, plus every lookup behind each answer. Type a name below. Nothing is stored. The same engine runs in the CLI, the API, and this page.

Nothing is stored. Every check runs against live DNS at the moment you ask, and the queries behind each answer are listed with it. The public checker is the same evaluators as POST /v1/checks on api.propgate.dev, npx @propgate/cli check, and the @propgate/dns library.

Use propgate when a customer has to configure DNS for you — custom sending domains, tracking hosts, ownership tokens — and you need a verdict you can switch on, not a regex over a TXT record. Four verdicts: pass, warn, fail, and indeterminate, because “this is broken” and “we could not tell” are different answers.

Developers: the OpenAPI spec is at /openapi.json, the agent index at /llms.txt, human docs at docs.propgate.dev, and the CLI is npx @propgate/cli. Accounts start with POST /v1/signup. Webhooks fire domain.verified, domain.degraded, domain.failed, and domain.recovered.

## Try it

- Web: [https://propgate.dev](https://propgate.dev)
- CLI: `npx @propgate/cli check example.com`
- API: `curl -s -X POST https://api.propgate.dev/v1/checks -H 'content-type: application/json' -d '{"domain":"example.com"}'`

## Developer resources

- [OpenAPI spec](https://propgate.dev/openapi.json)
- [llms.txt](https://propgate.dev/llms.txt)
- [API reference](https://docs.propgate.dev/api)
- [Authentication](https://docs.propgate.dev/authentication)
- [CLI](https://docs.propgate.dev/cli)
- [SDK](https://docs.propgate.dev/sdk)
- [Webhooks](https://docs.propgate.dev/webhooks)
- [Diagnosis taxonomy](https://docs.propgate.dev/taxonomy)
- [Sitemap](https://propgate.dev/sitemap.xml)
