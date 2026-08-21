import { codeToHtml } from "shiki";

/**
 * The same theme `next.config.ts` gives `@shikijs/rehype`, and the same one
 * `apps/docs` uses.
 *
 * Two highlighters run in this app — the rehype plugin for fenced code inside
 * a unit's MDX, and `highlight` below for the command strings a `Lookup`
 * block is handed. They have to agree, and `shiki.spec.ts` pins this constant
 * to the configured value so a change in one place fails rather than looking
 * merely inconsistent.
 */
export const SHIKI_THEME = "github-dark-dimmed";

export async function highlight(code: string, lang: string): Promise<string> {
  return await codeToHtml(code, { lang, theme: SHIKI_THEME });
}
