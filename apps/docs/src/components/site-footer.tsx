import Link from "next/link";

const LINKS = [
  { href: "/developers", title: "Developers" },
  { href: "/about", title: "About" },
  { href: "/contact", title: "Contact" },
  { href: "/privacy", title: "Privacy" },
  { href: "/llms.txt", title: "llms.txt" },
  { href: "/openapi.json", title: "OpenAPI" },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-border border-t px-4 py-6 md:px-6">
      <nav
        aria-label="propgate docs legal and developer links"
        className="flex flex-wrap gap-x-4 gap-y-2 text-muted-foreground text-xs"
      >
        {LINKS.map((link) => (
          <Link
            className="transition-colors hover:text-foreground"
            href={link.href}
            key={link.href}
          >
            {link.title}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
