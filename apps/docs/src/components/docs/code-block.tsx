import { highlight } from "@/lib/shiki";

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
      className="my-4 overflow-x-auto border border-border bg-muted text-sm leading-6 [&_pre]:p-4"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output, from literals in this repo
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
