import { readFileSync } from "node:fs";
import { join } from "node:path";

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
