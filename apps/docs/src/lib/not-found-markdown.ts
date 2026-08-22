import { SITE_URL } from "./site";

export function notFoundMarkdown(path = "/"): string {
  return `# Not found

\`${path}\` is not a page on propgate docs.

## Where to look next

- [llms.txt](${SITE_URL}/llms.txt): index of every page, with when-to-use guidance
- [Sitemap](${SITE_URL}/sitemap.xml): every indexable URL
- [OpenAPI](https://api.propgate.dev/openapi.json): the propgate API, including the public checker
- [Developer portal](${SITE_URL}/developers): keys, quickstart, sandbox
- [Docs index](${SITE_URL}/): introduction and the public check example
- [Page catalog](${SITE_URL}/v1/pages): machine-readable list of pages
`;
}
