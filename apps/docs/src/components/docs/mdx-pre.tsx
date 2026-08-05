import type { ComponentPropsWithoutRef } from "react";

/**
 * Fenced code in MDX is already highlighted by the time it reaches here.
 *
 * `@shikijs/rehype` runs during compilation and hands back a `<pre>` carrying
 * token spans and inline styles. This only frames it, and must not re-render the
 * children or the highlighting is thrown away.
 */
export function MdxPre({
  children,
  ...props
}: ComponentPropsWithoutRef<"pre">) {
  return (
    <div className="my-4 overflow-x-auto border border-white/5 text-[0.8125rem] leading-6">
      <pre className="p-4" {...props}>
        {children}
      </pre>
    </div>
  );
}
