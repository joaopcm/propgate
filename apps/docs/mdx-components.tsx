import type { MDXComponents } from "mdx/types";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    code: ({ children }) => (
      <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-sm">
        {children}
      </code>
    ),
    h1: ({ children }) => (
      <h1 className="mb-6 font-semibold text-3xl tracking-tight">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-10 mb-3 font-semibold text-xl tracking-tight">
        {children}
      </h2>
    ),
    p: ({ children }) => (
      <p className="mb-4 text-muted-foreground leading-7">{children}</p>
    ),
    ...components,
  };
}
