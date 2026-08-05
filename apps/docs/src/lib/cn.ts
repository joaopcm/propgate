/**
 * Join class names, dropping the falsy ones.
 *
 * Four lines rather than `clsx` and `tailwind-merge`. This app has no runtime
 * dependencies beyond Next, React and Shiki, and the only thing those two
 * packages would buy here is conflict resolution between Tailwind classes —
 * which is a problem this codebase does not have, because no component takes a
 * `className` override.
 */
export function cn(...values: (string | false | undefined | null)[]): string {
  return values.filter(Boolean).join(" ");
}
