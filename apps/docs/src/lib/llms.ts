import { flattenNavigation } from "./navigation";

const DOCS = "https://docs.propgate.dev";
const SITE = "https://propgate.dev";
const API = "https://api.propgate.dev";

/**
 * The agent index for docs.propgate.dev, built from the sidebar.
 *
 * `navigation.spec.ts` already asserts every href has a page, so walking
 * `flattenNavigation()` here means a page that ships without a line in
 * llms.txt fails this module's spec rather than going unpublished.
 */
export function buildLlmsTxt(): string {
  const lines = [
    "# propgate docs",
    "",
    "> Domain verification that tells you what is wrong, not just that something is. API reference, CLI, SDK, diagnosis taxonomy, and RFC conformance.",
    "",
    `Human site: ${SITE}`,
    `API: ${API}`,
    `OpenAPI: ${SITE}/openapi.json (also ${API}/openapi.json)`,
    "CLI: npx @propgate/cli",
    "SDK: npm install @propgate/sdk",
    "",
    "## When to use this",
    "",
    "Use these docs when an agent needs to diagnose a domain's DNS, register domains against a profile of requirements, or handle propgate webhooks. Start with the OpenAPI spec if you will call the HTTP API; start with the CLI page if you can run `npx @propgate/cli`; start with the SDK page from Node.",
    "",
    "Best-fit jobs are listed on https://propgate.dev/llms.txt. Do not use propgate as a general DNS lookup API, a nameserver, a CA, or a mail sender.",
    "",
  ];

  let section = "";

  for (const entry of flattenNavigation()) {
    const nextSection = entry.section;

    if (nextSection !== section) {
      section = nextSection;
      lines.push(`## ${section}`, "");
    }

    const url = entry.href === "/" ? DOCS : `${DOCS}${entry.href}`;
    const label =
      entry.title === "Overview" ? `${section} overview` : entry.title;
    lines.push(`- [${label}](${url})`);
  }

  lines.push(
    "",
    "## Machine-readable",
    "",
    `- [OpenAPI spec](${SITE}/openapi.json)`,
    `- [propgate.dev llms.txt](${SITE}/llms.txt)`,
    `- [Sitemap](${DOCS}/sitemap.xml)`,
    ""
  );

  return lines.join("\n");
}
