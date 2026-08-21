/**
 * Join class names, dropping the falsy ones.
 *
 * Four lines rather than `clsx` and `tailwind-merge`, the same trade
 * `apps/docs` makes: the only thing those two would buy is conflict resolution
 * between Tailwind classes, and no component here takes a `className`
 * override. `.claude/CLAUDE.md` lists `packages/ui` as deliberately not built,
 * so this is copied rather than shared, and that is the intended cost.
 */
export function cn(...values: (string | false | undefined | null)[]): string {
  return values.filter(Boolean).join(" ");
}
