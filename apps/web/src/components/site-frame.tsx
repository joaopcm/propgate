import type { ReactNode } from "react";
import { blocksFrom } from "@/lib/prose";
import { DOCS_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

export function SiteFrame({
  children,
  kicker = "propgate",
}: {
  children: ReactNode;
  kicker?: string;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-20 sm:py-28">
      <p className="font-mono text-muted-foreground/60 text-xs uppercase tracking-[0.2em]">
        {kicker}
      </p>
      {children}
      <SiteFooter />
    </main>
  );
}

export function Prose({ text }: { text: string }) {
  return (
    <div className="mt-8 space-y-4 text-muted-foreground text-sm leading-relaxed">
      {blocksFrom(text).map((block) =>
        block.kind === "p" ? (
          <p key={block.text.slice(0, 48)}>{block.text}</p>
        ) : (
          <ul className="list-disc space-y-2 pl-5" key={block.items[0]}>
            {block.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

const FOOTER_LINKS = [
  { href: "/", label: "Checker" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/privacy", label: "Privacy" },
  { href: `${DOCS_URL}/api`, label: "API" },
  { href: `${DOCS_URL}/cli`, label: "CLI" },
  { href: "/openapi.json", label: "OpenAPI" },
  { href: "/llms.txt", label: "llms.txt" },
] as const;

export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "mt-24 space-y-4 border-border border-t pt-8 text-muted-foreground/60 text-xs leading-relaxed",
        className
      )}
    >
      <nav className="flex flex-wrap gap-x-4 gap-y-2">
        {FOOTER_LINKS.map((link) => (
          <a
            className="underline decoration-transparent underline-offset-2 transition-colors hover:text-foreground hover:decoration-current"
            href={link.href}
            key={link.href}
          >
            {link.label}
          </a>
        ))}
      </nav>
    </footer>
  );
}
