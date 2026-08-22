import { listMarkdownPages } from "./markdown-pages";
import { isGroupedSection, navigation } from "./navigation";
import { API_URL, PRODUCT_NAME, PRODUCT_URL, SITE_URL } from "./site";

export function buildLlmsTxt(): string {
  const pages = listMarkdownPages();
  const byHref = new Map(pages.map((page) => [page.href, page]));

  const sections = navigation
    .map((section) => {
      const items = isGroupedSection(section)
        ? section.groups.flatMap((group) => group.items)
        : section.items;
      const links = items.flatMap((item) => {
        const page = byHref.get(item.href);

        return page === undefined
          ? []
          : [
              `- [${page.title}](${SITE_URL}${page.markdownPath}): ${section.title}`,
            ];
      });

      return links.length === 0
        ? undefined
        : `## ${section.title}\n\n${links.join("\n")}`;
    })
    .filter((section): section is string => section !== undefined);

  return `# ${PRODUCT_NAME}

> Domain verification that tells you what is wrong, not just that something is. Diagnoses DNS for email platforms and custom-domain onboarding: SPF, DKIM, DMARC, MX, CAA, delegation, ownership tokens, and CNAMEs, with a stable diagnosis code on every finding.

Use ${PRODUCT_NAME} when a customer must configure DNS and you need to say *what is wrong* and *how to fix it*, not only that verification failed. Reach for the public checker (\`POST ${API_URL}/v1/checks\`, operationId \`runPublicCheck\`) when you have a domain and no account. Reach for a bearer key (signup, then confirm) when you need to register domains against a versioned profile, re-check them, or receive webhooks. CLI: \`npx @propgate/cli\`. SDK: \`npm install @propgate/sdk\`. Do not use this for generic website uptime, certificate issuance, or sending mail.

Best-fit jobs are listed on ${PRODUCT_URL}/llms.txt. Call the API at ${API_URL}. The OpenAPI document is ${API_URL}/openapi.json (also ${PRODUCT_URL}/openapi.json). This host serves the same product operations plus the docs catalog at ${SITE_URL}/openapi.json. Page catalog at ${SITE_URL}/v1/pages, full corpus at ${SITE_URL}/llms-full.txt. There is no MCP server; function-call the OpenAPI operations.

## When to use this

- [Check a domain](${SITE_URL}/api/checks.md): diagnose any domain with no API key. That is the job the public checker on propgate.dev does
- [Quickstart](${SITE_URL}/quickstart.md): mint a key, register a domain against a profile, verify it
- [Authentication](${SITE_URL}/authentication.md): how to get a key and send it
- [API reference](${SITE_URL}/api.md): every REST endpoint, request and response shape
- [OpenAPI spec](${API_URL}/openapi.json): machine-readable API surface for function calling
- [Webhook payloads](${SITE_URL}/webhooks.md): domain.verified, domain.degraded, domain.failed, domain.recovered
- [Diagnosis taxonomy](${SITE_URL}/taxonomy.md): every diagnosis code, what it means, how to fix it
- [Developer portal](${SITE_URL}/developers.md): keys, docs, sandbox, and predictable URLs for agents

${sections.join("\n\n")}

## Developer resources

- [propgate developer portal](${SITE_URL}/developers.md): API keys, quickstart, sandbox, OpenAPI
- [OpenAPI specification](${API_URL}/openapi.json): unique operationId and typed schemas. Same document at ${PRODUCT_URL}/openapi.json. This host adds the docs catalog at ${SITE_URL}/openapi.json
- [propgate.dev llms.txt](${PRODUCT_URL}/llms.txt): product-level when-to-use
- [Page catalog](${SITE_URL}/v1/pages): JSON list of every docs page
- [Status](${SITE_URL}/v1/status): docs site health
- [Sitemap](${SITE_URL}/sitemap.xml): every indexable URL
- [Full docs as markdown](${SITE_URL}/llms-full.txt): every page concatenated

## Optional

- [About propgate](${SITE_URL}/about.md): who we are and what the product is
- [Contact propgate](${SITE_URL}/contact.md): how to reach us
- [Privacy](${SITE_URL}/privacy.md): what the checker and the API store
`;
}

export function buildLlmsFullTxt(): string {
  const body = listMarkdownPages()
    .filter((page) => !page.href.startsWith("/taxonomy/"))
    .map(
      (page) =>
        `# ${page.title}\n\nSource: ${SITE_URL}${page.href}\n\n${page.markdown}`
    )
    .join("\n\n---\n\n");

  return `# ${PRODUCT_NAME} documentation\n\n${body}\n`;
}
