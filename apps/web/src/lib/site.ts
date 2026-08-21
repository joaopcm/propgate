/**
 * Copy and machine-readable files for propgate.dev.
 *
 * One module so the HTML pages, the markdown variants, llms.txt and the
 * JSON-LD cannot disagree about what the product is. Specs below assert
 * the lengths and filenames an agent audit actually counts.
 */

export const SITE_URL = "https://propgate.dev";
export const API_URL = "https://api.propgate.dev";
export const DOCS_URL = "https://docs.propgate.dev";
export const GITHUB_URL = "https://github.com/joaopcm/propgate";
export const CLI_PACKAGE = "@propgate/cli";
export const SDK_PACKAGE = "@propgate/sdk";
export const DNS_PACKAGE = "@propgate/dns";

export const SITE_NAME = "propgate";

export const SITE_DESCRIPTION =
  "propgate is domain verification that tells you what is wrong, not just that something is. Six checks — nameservers, SPF, DKIM, DMARC, mail delivery, certificate authorities — and every DNS query behind them.";

export const HOME_H1 = "What is actually wrong with this domain?";

export const HOME_LEAD =
  "propgate diagnoses a domain's DNS the way a receiving mail server would: nameservers, SPF, DKIM, DMARC, mail delivery, and certificate authorities, plus every lookup behind each answer. Type a name below. Nothing is stored. The same engine runs in the CLI, the API, and this page.";

/**
 * Footer prose that stays in the prerendered HTML.
 *
 * The checker is a client component. Crawlers that do not execute JavaScript
 * still see this, the H1, and HOME_LEAD, which is the whole point of keeping
 * it out of the interactive tree.
 */
export const HOME_FOOTER = [
  "Nothing is stored. Every check runs against live DNS at the moment you ask, and the queries behind each answer are listed with it. The public checker is the same evaluators as POST /v1/checks on api.propgate.dev, npx @propgate/cli check, and the @propgate/dns library.",
  "Use propgate when a customer has to configure DNS for you — custom sending domains, tracking hosts, ownership tokens — and you need a verdict you can switch on, not a regex over a TXT record. Four verdicts: pass, warn, fail, and indeterminate, because “this is broken” and “we could not tell” are different answers.",
  "Developers: the OpenAPI spec is at /openapi.json, the agent index at /llms.txt, human docs at docs.propgate.dev, and the CLI is npx @propgate/cli. Accounts start with POST /v1/signup. Webhooks fire domain.verified, domain.degraded, domain.failed, and domain.recovered.",
].join("\n\n");

export const HOME_MARKDOWN = `# propgate

${HOME_H1}

${HOME_LEAD}

${HOME_FOOTER}

## Try it

- Web: [https://propgate.dev](https://propgate.dev)
- CLI: \`npx ${CLI_PACKAGE} check example.com\`
- API: \`curl -s -X POST ${API_URL}/v1/checks -H 'content-type: application/json' -d '{"domain":"example.com"}'\`

## Developer resources

- [OpenAPI spec](${SITE_URL}/openapi.json)
- [llms.txt](${SITE_URL}/llms.txt)
- [API reference](${DOCS_URL}/api)
- [Authentication](${DOCS_URL}/authentication)
- [CLI](${DOCS_URL}/cli)
- [SDK](${DOCS_URL}/sdk)
- [Webhooks](${DOCS_URL}/webhooks)
- [Diagnosis taxonomy](${DOCS_URL}/taxonomy)
- [Sitemap](${SITE_URL}/sitemap.xml)
`;

export const ABOUT_H1 = "About propgate";

export const ABOUT_BODY = `propgate is domain verification infrastructure for products whose customers have to configure DNS. Email platforms, custom-domain dashboards, anything with a “verify your domain” screen: they all rebuild the same brittle checker, then spend years discovering provider quirks that a regex over a TXT record cannot see.

This is that checker, as a library, a CLI, a public web page, and an API. It expands SPF the way an MTA would, with the ten-lookup and two-void-lookup limits counted. It parses DKIM keys. It climbs the CAA tree per RFC 8659. It asks every nameserver in the delegation and reports when they disagree. It distinguishes a domain that is broken from a lookup that timed out, because collapsing those two is how a monitoring product pages someone at 3am over its own bad second.

The public checker on this site stores nothing. You type a domain, we ask live DNS, we return findings with the queries behind them, and that is the whole transaction. Teams that need to remember domains — pin them to a profile of requirements, re-check them, fire a webhook when one fails — use the API at api.propgate.dev, the Node SDK, or the CLI.

The DNS library and the SDKs are MIT licensed. The source is at ${GITHUB_URL}. RFC conformance is published at ${DOCS_URL}/conformance: which normative statements a verifier implements, which it does not, and which test asserts each one.`;

export const ABOUT_MARKDOWN = `# ${ABOUT_H1}

${ABOUT_BODY}

## Where to go next

- [propgate.dev](${SITE_URL}) — public checker
- [Docs](${DOCS_URL})
- [OpenAPI](${SITE_URL}/openapi.json)
- [Contact](${SITE_URL}/contact)
- [Privacy](${SITE_URL}/privacy)
- [GitHub](${GITHUB_URL})
`;

export const CONTACT_H1 = "Contact propgate";

export const CONTACT_BODY = `The fastest way to reach the people who write propgate is GitHub. Open an issue at ${GITHUB_URL}/issues for a bug, a wrong diagnosis, a question about an API response, or a feature. The diagnosis taxonomy at ${DOCS_URL}/taxonomy is the map of every code the API can return; if a finding looks wrong, name the code.

There is no sales form on this site and no chatbot. The public checker does not collect an email address. If you already have an API key, you minted it by proving control of a mailbox through POST /v1/signup — that address is how we would reach you about the account, and it is not a support inbox.

Developer resources, so you do not have to wait on a human:

- API reference: ${DOCS_URL}/api
- Authentication: ${DOCS_URL}/authentication
- OpenAPI spec: ${SITE_URL}/openapi.json
- CLI: npx ${CLI_PACKAGE} — docs at ${DOCS_URL}/cli
- Node SDK: npm install ${SDK_PACKAGE} — docs at ${DOCS_URL}/sdk
- Webhooks: ${DOCS_URL}/webhooks
- Agent index: ${SITE_URL}/llms.txt

The product is source-available at ${GITHUB_URL}. Pull requests and issues are the contact channel.`;

export const CONTACT_MARKDOWN = `# ${CONTACT_H1}

${CONTACT_BODY}
`;

export const PRIVACY_H1 = "Privacy — propgate";

export const PRIVACY_BODY = `This page is about what propgate actually collects. It is not a substitute for reading the code; both the public checker and the API are in the repository at ${GITHUB_URL}.

The website at propgate.dev is a static front end. The domain you type into the checker is sent to POST ${API_URL}/v1/checks so the check can run. That endpoint is request-driven and stateless: nothing about the domain, the findings, or your address is stored. There is no account cookie, no analytics pixel, and no third-party marketing script on this site.

If you create an account, we store the email address you proved control of, a hash of each API key, the domains you register, the profiles you define, webhook URLs, hashed webhook secrets, and the results of checks you ask us to remember. We store those because that is the product — a domain nobody can look up again is not being monitored. We do not sell this data. We do not use it to advertise. Keys are shown once; only their hashes remain.

OTP codes used at signup are stored hashed, expire in ten minutes, and are limited in attempts. Mail is sent so you can confirm the address. If you self-host the API, this data lives on your box, not ours.

To ask a question about data we hold on an account, open an issue at ${GITHUB_URL}/issues. To stop us tracking a domain, delete it through the API or CLI. Revoking a key takes effect on the next request.`;

export const PRIVACY_MARKDOWN = `# ${PRIVACY_H1}

${PRIVACY_BODY}
`;

export const NOT_FOUND_MARKDOWN = `# Not found

This path does not exist on propgate.dev.

## Where to look next

- [Home](${SITE_URL})
- [Sitemap](${SITE_URL}/sitemap.xml)
- [llms.txt](${SITE_URL}/llms.txt) — agent index, including when to use propgate
- [OpenAPI spec](${SITE_URL}/openapi.json)
- [Docs](${DOCS_URL})
- [API reference](${DOCS_URL}/api)
- [CLI](${DOCS_URL}/cli)
- [About](${SITE_URL}/about)
- [Contact](${SITE_URL}/contact)
- [Privacy](${SITE_URL}/privacy)
`;

export const LLMS_TXT = `# propgate

> Domain verification that tells you what is wrong, not just that something is.

propgate diagnoses DNS for products whose customers configure records: custom sending domains, tracking hosts, ownership tokens, CAA. Six checks (nameservers, SPF, DKIM, DMARC, mail delivery, certificate authorities) plus the lookups behind each answer. Four verdicts: pass, warn, fail, indeterminate.

Website: ${SITE_URL}
API: ${API_URL}
Docs: ${DOCS_URL}
Source: ${GITHUB_URL}

## When to use this

Reach for propgate when an agent or a product needs a programmatic verdict about a domain's DNS, not a screenshot of a dashboard.

Best-fit jobs:
- A user (or an agent acting for one) has just written SPF, DKIM, DMARC, MX, CAA, CNAME, or an ownership TXT, and you need to know whether it is actually correct.
- You are building or operating a “verify your domain” flow and want findings you can switch on (\`SPF_LOOKUP_LIMIT_NEAR\`, \`NS_SERIAL_MISMATCH\`, …) rather than a boolean.
- You need to tell “the record is wrong” from “we could not tell” (timeout, unreachable nameserver). The latter is \`indeterminate\`, not \`fail\`.
- You want to register many customer domains against a versioned profile of requirements, re-check them, and get a signed webhook when one fails or recovers.

How to call us:
1. One-shot diagnosis, no account: \`POST ${API_URL}/v1/checks\` with \`{"domain":"example.com"}\`, or \`npx ${CLI_PACKAGE} check example.com\`, or \`npx ${CLI_PACKAGE} check example.com --remote\`.
2. Remembered domains: \`POST ${API_URL}/v1/signup\` then \`POST ${API_URL}/v1/signup/confirm\` for a key; then profiles, domains, checks, webhooks as in ${DOCS_URL}/quickstart. From Node, \`npm install ${SDK_PACKAGE}\`.
3. Read the OpenAPI document at ${SITE_URL}/openapi.json (also ${API_URL}/openapi.json) before inventing paths. Every operation has an operationId, typed parameters, and an error envelope with \`code\`, \`message\`, and \`hint\`.

Do not use propgate as a general DNS lookup API, a nameserver host, a certificate authority, or an email sender. We inspect records. We do not serve them, issue certificates, or deliver mail.

## Developer resources

- [OpenAPI spec](${SITE_URL}/openapi.json): machine-readable API surface. Same document at ${API_URL}/openapi.json.
- [API reference](${DOCS_URL}/api): every endpoint, request and response shape, curl / CLI / SDK.
- [Authentication](${DOCS_URL}/authentication): bearer keys, \`Authorization: Bearer pg_live_...\`.
- [Quickstart](${DOCS_URL}/quickstart): get a key, register a domain, verify it.
- [CLI](${DOCS_URL}/cli): \`npx ${CLI_PACKAGE}\` — official CLI on npm. \`propgate check\` needs no account.
- [Node SDK](${DOCS_URL}/sdk): \`npm install ${SDK_PACKAGE}\`. \`{ data, error, meta }\`, never a throw.
- [Webhooks](${DOCS_URL}/webhooks): \`domain.verified\`, \`domain.degraded\`, \`domain.failed\`, \`domain.recovered\`. Svix-compatible signatures.
- [Diagnosis taxonomy](${DOCS_URL}/taxonomy): every code, what it means, how to fix it.
- [@propgate/dns](${DOCS_URL}/dns): the resolver and evaluators, MIT, zero runtime dependencies.
- [RFC conformance](${DOCS_URL}/conformance): what we implement and what we do not.
- [Sitemap](${SITE_URL}/sitemap.xml)
- [About](${SITE_URL}/about)
- [Contact](${SITE_URL}/contact)
- [Privacy](${SITE_URL}/privacy)
`;

export const INDEXABLE_PATHS = ["/", "/about", "/contact", "/privacy"] as const;

export type IndexablePath = (typeof INDEXABLE_PATHS)[number];

export const MARKDOWN_FOR_PATH: Readonly<Record<IndexablePath, string>> = {
  "/": HOME_MARKDOWN,
  "/about": ABOUT_MARKDOWN,
  "/contact": CONTACT_MARKDOWN,
  "/privacy": PRIVACY_MARKDOWN,
};

export function jsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@id": `${SITE_URL}/#organization`,
        "@type": "Organization",
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "developer support",
          url: `${GITHUB_URL}/issues`,
        },
        description: SITE_DESCRIPTION,
        name: SITE_NAME,
        sameAs: [
          GITHUB_URL,
          `https://www.npmjs.com/package/${CLI_PACKAGE}`,
          `https://www.npmjs.com/package/${SDK_PACKAGE}`,
          `https://www.npmjs.com/package/${DNS_PACKAGE}`,
        ],
        url: SITE_URL,
      },
      {
        "@id": `${SITE_URL}/#app`,
        "@type": "SoftwareApplication",
        applicationCategory: "DeveloperApplication",
        description: SITE_DESCRIPTION,
        name: SITE_NAME,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        operatingSystem: "Any",
        publisher: { "@id": `${SITE_URL}/#organization` },
        url: SITE_URL,
      },
      {
        "@id": SITE_URL,
        "@type": "WebSite",
        description: SITE_DESCRIPTION,
        name: SITE_NAME,
        publisher: { "@id": `${SITE_URL}/#organization` },
        url: SITE_URL,
      },
    ],
  };
}
