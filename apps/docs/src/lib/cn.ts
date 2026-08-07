/**
 * Join class names, dropping the falsy ones.
 *
 * Four lines rather than `clsx` and `tailwind-merge`. The only thing those two
 * packages would buy here is conflict resolution between Tailwind classes —
 * which is a problem this codebase does not have, because no component takes a
 * `className` override.
 *
 * This app's runtime dependencies are Next, React, Shiki and
 * `react-hotkeys-hook`, the last of which arrived with the header search and is
 * the only one that is not load-bearing for rendering a page. Two four-line
 * helpers is a low price for keeping that list short.
 */
export function cn(...values: (string | false | undefined | null)[]): string {
  return values.filter(Boolean).join(" ");
}
