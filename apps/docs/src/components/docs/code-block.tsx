import { highlight } from "@/lib/shiki";

/**
 * `dangerouslySetInnerHTML` is correct here and nowhere near a user.
 *
 * Shiki returns markup, and every string it is given in this app is a literal
 * written in this repository — there is no request-time input on this path, and
 * the site is a static export with no user content at all.
 */
export async function CodeBlock({
  code,
  lang,
}: {
  code: string;
  lang: string;
}) {
  const html = await highlight(code.trim(), lang);

  return (
    <div
      className="my-4 overflow-x-auto border border-white/5 bg-muted text-[0.8125rem] leading-6 [&_pre]:p-4"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output, from literals in this repo
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
