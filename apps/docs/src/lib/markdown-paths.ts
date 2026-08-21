/**
 * Where a page's markdown twin lives, as pure string arithmetic.
 *
 * Split out of `markdown-pages.ts`, and the split is load-bearing rather than
 * tidiness. That module reads `page.mdx` off disk to *generate* markdown, so it
 * imports `node:fs`, `node:path`, and — through the taxonomy — `@propgate/dns`
 * and `@propgate/dns-fixtures`. All of which is correct at build time and none
 * of which exists in a Worker.
 *
 * `negotiate.ts` needed one two-line function from it. ES modules evaluate the
 * whole module for one named import, so the Worker bundle acquired the DNS
 * resolver, a UDP socket, and a filesystem — and Cloudflare rejected the script
 * with `No such module "node:fs"`, after uploading every asset. The docs deploy
 * failed that way for three releases while the pages themselves published fine.
 *
 * So: anything the Worker needs lives here, and this module imports nothing at
 * all — not even `./site`, which is why `absoluteMarkdownUrl` did not come
 * across with the other two. It had no caller anywhere in the app, and seeding a
 * new module with an unused export that costs it its only dependency is a poor
 * trade. It is four lines to bring back if something wants it.
 *
 * `worker-graph.spec.ts` enforces the emptiness by walking the graph from
 * `worker.ts`.
 */

export function markdownPathFor(href: string): string {
  return href === "/" ? "/index.md" : `${href}.md`;
}

export function markdownHrefFromAssetPath(
  pathname: string
): string | undefined {
  if (!pathname.endsWith(".md")) {
    return;
  }

  if (pathname === "/index.md") {
    return "/";
  }

  return pathname.slice(0, -".md".length);
}
