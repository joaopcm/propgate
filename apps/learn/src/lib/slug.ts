/**
 * One slugifier, shared by every heading id in the app.
 *
 * Identical to the docs' so that a link written in one app's prose and
 * followed into the other lands where its author meant. A divergence here
 * fails silently: the page loads and the reader arrives at the top.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
