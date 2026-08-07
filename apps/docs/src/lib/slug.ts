/**
 * One slugifier, two callers.
 *
 * `mdx-components.tsx` puts the result on every `h2` and `h3`; the search index
 * puts the same result in the `hash` of every section record. If those two ever
 * disagree the failure is silent — the link resolves, the page loads, and the
 * reader lands at the top instead of at the section they searched for. Sharing
 * one function is what makes that impossible rather than merely unlikely.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
