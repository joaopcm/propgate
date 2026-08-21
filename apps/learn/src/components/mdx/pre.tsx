import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

/**
 * Fenced code in MDX arrives already highlighted.
 *
 * `@shikijs/rehype` runs during compilation and hands back a `<pre>` carrying
 * token spans and inline styles. This only frames it and must not re-render the
 * children, or the highlighting is thrown away.
 *
 * `className` is destructured out and merged rather than spread after the
 * literal, because spreading `...props` after `className="p-4"` lets Shiki's
 * own class win and silently drops the padding.
 */
export function Pre({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"pre">) {
  return (
    <div className="my-6 overflow-x-auto border border-border bg-muted text-[0.8125rem] leading-6">
      <pre className={cn("p-4", className)} {...props}>
        {children}
      </pre>
    </div>
  );
}
