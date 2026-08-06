import type { MDXComponents } from "mdx/types";
import {
  type ComponentPropsWithoutRef,
  isValidElement,
  type ReactNode,
} from "react";
import { MdxPre } from "@/components/docs/mdx-pre";
import { slugify } from "@/lib/slug";

/**
 * The text of a heading, whatever it is made of.
 *
 * `## The \`SWEEP_TICK_SECONDS\` loop` reaches here as three children — a
 * string, a `<code>` element, another string — so the id cannot come from
 * `children` directly. The search index slugifies the same words off the raw
 * markdown, and a mismatch is silent: the link resolves, the page loads, and
 * the reader lands at the top.
 */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(textOf).join("");
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textOf(node.props.children);
  }

  return "";
}

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    a: ({ children, ...props }: ComponentPropsWithoutRef<"a">) => (
      <a
        className="text-foreground underline underline-offset-4 transition-colors hover:text-muted-foreground"
        {...props}
      >
        {children}
      </a>
    ),
    code: ({ children, ...props }: ComponentPropsWithoutRef<"code">) => (
      <code
        className="rounded-none bg-muted px-1 py-0.5 font-mono text-[0.85em]"
        {...props}
      >
        {children}
      </code>
    ),
    h1: ({ children, ...props }: ComponentPropsWithoutRef<"h1">) => (
      <h1
        className="mb-4 font-semibold text-3xl text-foreground tracking-tight"
        {...props}
      >
        {children}
      </h1>
    ),
    h2: ({ children, ...props }: ComponentPropsWithoutRef<"h2">) => (
      <h2
        className="mt-10 mb-3 font-semibold text-foreground text-xl tracking-tight"
        id={slugify(textOf(children))}
        {...props}
      >
        {children}
      </h2>
    ),
    h3: ({ children, ...props }: ComponentPropsWithoutRef<"h3">) => (
      <h3
        className="mt-8 mb-2 font-semibold text-foreground text-lg tracking-tight"
        id={slugify(textOf(children))}
        {...props}
      >
        {children}
      </h3>
    ),
    ol: ({ children, ...props }: ComponentPropsWithoutRef<"ol">) => (
      <ol
        className="my-3 list-decimal pl-5 text-muted-foreground text-sm leading-7"
        {...props}
      >
        {children}
      </ol>
    ),
    p: ({ children, ...props }: ComponentPropsWithoutRef<"p">) => (
      <p className="my-3 text-muted-foreground text-sm leading-7" {...props}>
        {children}
      </p>
    ),
    pre: MdxPre,
    table: ({ children, ...props }: ComponentPropsWithoutRef<"table">) => (
      <div className="my-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm" {...props}>
          {children}
        </table>
      </div>
    ),
    tbody: ({ children, ...props }: ComponentPropsWithoutRef<"tbody">) => (
      <tbody className="divide-y divide-border" {...props}>
        {children}
      </tbody>
    ),
    td: ({ children, ...props }: ComponentPropsWithoutRef<"td">) => (
      <td className="px-3 py-2 text-muted-foreground" {...props}>
        {children}
      </td>
    ),
    th: ({ children, ...props }: ComponentPropsWithoutRef<"th">) => (
      <th
        className="px-3 py-2 text-left font-medium text-foreground text-xs uppercase tracking-wider"
        {...props}
      >
        {children}
      </th>
    ),
    thead: ({ children, ...props }: ComponentPropsWithoutRef<"thead">) => (
      <thead className="border-border border-b" {...props}>
        {children}
      </thead>
    ),
    tr: ({ children, ...props }: ComponentPropsWithoutRef<"tr">) => (
      <tr className="transition-colors hover:bg-muted/30" {...props}>
        {children}
      </tr>
    ),
    ul: ({ children, ...props }: ComponentPropsWithoutRef<"ul">) => (
      <ul
        className="my-3 list-disc pl-5 text-muted-foreground text-sm leading-7"
        {...props}
      >
        {children}
      </ul>
    ),
    ...components,
  };
}
