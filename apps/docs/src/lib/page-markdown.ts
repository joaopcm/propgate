import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * An MDX page as markdown, near-verbatim.
 *
 * Deliberately not a JSX-to-markdown transformer. Substituting snippet
 * constants into rendered components is several hundred lines that can silently
 * drop content, and an agent reading `<CodeTabs items={[…]} />` around a fenced
 * block loses nothing it needed. Imports and the metadata export go, because
 * those are machinery rather than content.
 */

const IMPORT_LINE = /^import\s/;
const METADATA_BLOCK = /^export const metadata = \{[\s\S]*?\n\};?\n/m;
const BLANK_RUN = /\n{3,}/g;

export function pageMarkdown(mdxPath: string): string {
  const raw = readFileSync(join(process.cwd(), mdxPath), "utf8");

  return raw
    .replace(METADATA_BLOCK, "")
    .split("\n")
    .filter((line) => !IMPORT_LINE.test(line))
    .join("\n")
    .replace(BLANK_RUN, "\n\n")
    .trim();
}
