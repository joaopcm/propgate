import { codeToHtml } from "shiki";

/**
 * The same theme `next.config.ts` gives `@shikijs/rehype`.
 *
 * Two highlighters run in this app — the rehype plugin for fenced code inside
 * MDX, and `highlight` below for the strings that `CodeTabs` is handed. They
 * have to agree, and a spec pins this constant to the configured value so a
 * change in one place fails rather than looking merely inconsistent.
 */
export const SHIKI_THEME = "github-dark-dimmed";

export async function highlight(code: string, lang: string): Promise<string> {
  return await codeToHtml(code, { lang, theme: SHIKI_THEME });
}
