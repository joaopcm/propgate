import type { MDXComponents } from "mdx/types";
import {
  type ComponentPropsWithoutRef,
  isValidElement,
  type ReactNode,
} from "react";
import { Pre } from "@/components/mdx/pre";
import { slugify } from "@/lib/slug";

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
        className="text-foreground underline decoration-muted-foreground underline-offset-4 transition-colors hover:decoration-mark"
        {...props}
      >
        {children}
      </a>
    ),
    blockquote: ({
      children,
      ...props
    }: ComponentPropsWithoutRef<"blockquote">) => (
      <blockquote
        className="my-6 border-rule border-l-2 pl-4 text-foreground/85 italic"
        {...props}
      >
        {children}
      </blockquote>
    ),
    code: ({ children, ...props }: ComponentPropsWithoutRef<"code">) => (
      <code
        className="bg-muted px-1 py-0.5 font-mono text-[0.8em] text-foreground"
        {...props}
      >
        {children}
      </code>
    ),
    h1: () => null,
    h2: ({ children, ...props }: ComponentPropsWithoutRef<"h2">) => (
      <h2
        className="mt-14 mb-4 font-display text-2xl leading-tight tracking-tight sm:text-3xl"
        id={slugify(textOf(children))}
        {...props}
      >
        {children}
      </h2>
    ),
    h3: ({ children, ...props }: ComponentPropsWithoutRef<"h3">) => (
      <h3
        className="mt-10 mb-3 font-semibold text-foreground text-lg tracking-tight"
        id={slugify(textOf(children))}
        {...props}
      >
        {children}
      </h3>
    ),
    hr: (props: ComponentPropsWithoutRef<"hr">) => (
      <hr className="my-10 border-border" {...props} />
    ),
    li: ({ children, ...props }: ComponentPropsWithoutRef<"li">) => (
      <li className="my-1.5" {...props}>
        {children}
      </li>
    ),
    ol: ({ children, ...props }: ComponentPropsWithoutRef<"ol">) => (
      <ol
        className="my-5 list-decimal pl-6 text-[1.0625rem] text-foreground/85 leading-[1.75]"
        {...props}
      >
        {children}
      </ol>
    ),
    p: ({ children, ...props }: ComponentPropsWithoutRef<"p">) => (
      <p
        className="my-5 max-w-[38rem] text-[1.0625rem] text-foreground/85 leading-[1.75]"
        {...props}
      >
        {children}
      </p>
    ),
    pre: Pre,
    strong: ({ children, ...props }: ComponentPropsWithoutRef<"strong">) => (
      <strong className="font-semibold text-foreground" {...props}>
        {children}
      </strong>
    ),
    table: ({ children, ...props }: ComponentPropsWithoutRef<"table">) => (
      <div className="my-6 overflow-x-auto">
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
      <td className="px-3 py-2 align-top text-muted-foreground" {...props}>
        {children}
      </td>
    ),
    th: ({ children, ...props }: ComponentPropsWithoutRef<"th">) => (
      <th
        className="px-3 py-2 text-left font-medium font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-wider"
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
    ul: ({ children, ...props }: ComponentPropsWithoutRef<"ul">) => (
      <ul
        className="my-5 list-disc pl-6 text-[1.0625rem] text-foreground/85 leading-[1.75]"
        {...props}
      >
        {children}
      </ul>
    ),
    ...components,
  };
}
