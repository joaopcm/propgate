import { listMarkdownPages } from "./markdown-pages";
import { SITE_NAME, SITE_URL } from "./site";

export interface CatalogPage {
  readonly href: string;
  readonly htmlUrl: string;
  readonly markdownUrl: string;
  readonly title: string;
}

export interface Catalog {
  readonly name: string;
  readonly object: "catalog";
  readonly pages: readonly CatalogPage[];
}

export function docsCatalog(): Catalog {
  return {
    name: SITE_NAME,
    object: "catalog",
    pages: listMarkdownPages()
      .filter((page) => !page.href.startsWith("/taxonomy/"))
      .map((page) => ({
        href: page.href,
        htmlUrl: `${SITE_URL}${page.href === "/" ? "/" : page.href}`,
        markdownUrl: `${SITE_URL}${page.markdownPath}`,
        title: page.title,
      })),
  };
}

export interface StatusBody {
  readonly api: string;
  readonly name: string;
  readonly object: "status";
  readonly openapi: string;
  readonly status: "ok";
}

export function docsStatus(): StatusBody {
  return {
    api: "https://api.propgate.dev",
    name: SITE_NAME,
    object: "status",
    openapi: `${SITE_URL}/openapi.json`,
    status: "ok",
  };
}
