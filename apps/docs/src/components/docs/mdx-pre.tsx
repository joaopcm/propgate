import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

/**
 * Fenced code in MDX is already highlighted by the time it reaches here.
 *
 * `@shikijs/rehype` runs during compilation and hands back a `<pre>` carrying
 * token spans and inline styles. This only frames it, and must not re-render the
 * children or the highlighting is thrown away.
 *
 * `className` is destructured out and merged with `cn` rather than spread
 * after the literal class — spreading `...props` after `className="p-4"`
 * would let Shiki's own class win and silently drop the padding.
 */
export function MdxPre({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"pre">) {
  return (
    <div className="my-4 overflow-x-auto border border-white/5 bg-muted text-[0.8125rem] leading-6">
      <pre className={cn("p-4", className)} {...props}>
        {children}
      </pre>
    </div>
  );
}
