import { existsSync } from "node:fs";
import { join } from "node:path";
import { markdownPathFor } from "./markdown-paths";
import { flattenNavigation } from "./navigation";
import { pageMarkdown } from "./page-markdown";
import { allEntries } from "./taxonomy";
import {
  conformanceMarkdown,
  taxonomyCodeMarkdown,
  taxonomyIndexMarkdown,
  webhooksMarkdown,
} from "./tsx-markdown";

const APP = join(process.cwd(), "src/app/(docs)");

const TSX_MARKDOWN: Record<string, () => string> = {
  "/conformance": conformanceMarkdown,
  "/taxonomy": taxonomyIndexMarkdown,
  "/webhooks": webhooksMarkdown,
};

export interface MarkdownPage {
  readonly href: string;
  readonly markdown: string;
  readonly markdownPath: string;
  readonly section?: string;
  readonly title: string;
}

function mdxPathFor(href: string): string {
  return join(APP, href === "/" ? "" : href, "page.mdx");
}

function tsxPathFor(href: string): string {
  return join(APP, href === "/" ? "" : href, "page.tsx");
}

export function htmlPathHasPage(href: string): boolean {
  return existsSync(mdxPathFor(href)) || existsSync(tsxPathFor(href));
}

function markdownForNavHref(href: string): string | undefined {
  const generate = TSX_MARKDOWN[href];

  if (generate !== undefined) {
    return generate();
  }

  if (existsSync(mdxPathFor(href))) {
    const relative = href === "/" ? "" : href;

    return pageMarkdown(`src/app/(docs)${relative}/page.mdx`);
  }
}

function extraPages(): MarkdownPage[] {
  const extras: { href: string; title: string }[] = [
    { href: "/about", title: "About propgate" },
    { href: "/contact", title: "Contact propgate" },
    { href: "/developers", title: "propgate developer portal" },
    { href: "/privacy", title: "Privacy" },
  ];

  return extras.flatMap((page) => {
    const markdown = markdownForNavHref(page.href);

    return markdown === undefined
      ? []
      : [
          {
            href: page.href,
            markdown,
            markdownPath: markdownPathFor(page.href),
            title: page.title,
          },
        ];
  });
}

function taxonomyPages(): MarkdownPage[] {
  return allEntries().map((entry) => ({
    href: `/taxonomy/${entry.definition.slug}`,
    markdown: taxonomyCodeMarkdown(entry.definition.slug) ?? "",
    markdownPath: markdownPathFor(`/taxonomy/${entry.definition.slug}`),
    section: "Reference",
    title: entry.definition.code,
  }));
}

export function listMarkdownPages(): MarkdownPage[] {
  const nav = flattenNavigation().flatMap((entry) => {
    const markdown = markdownForNavHref(entry.href);

    return markdown === undefined
      ? []
      : [
          {
            href: entry.href,
            markdown,
            markdownPath: markdownPathFor(entry.href),
            section: entry.section,
            title: entry.title,
          },
        ];
  });

  const seen = new Set(nav.map((page) => page.href));
  const rest = [...extraPages(), ...taxonomyPages()].filter(
    (page) => !seen.has(page.href)
  );

  return [...nav, ...rest];
}

export function markdownPageByHref(href: string): MarkdownPage | undefined {
  return listMarkdownPages().find((page) => page.href === href);
}
