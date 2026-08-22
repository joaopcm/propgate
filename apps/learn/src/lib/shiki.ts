import { codeToHtml } from "shiki";

export const SHIKI_THEME = "github-dark-dimmed";

export async function highlight(code: string, lang: string): Promise<string> {
  return await codeToHtml(code, { lang, theme: SHIKI_THEME });
}
