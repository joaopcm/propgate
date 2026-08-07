import Link from "next/link";
import { DocsSearch } from "@/components/docs-search";
import { MobileSidebar } from "@/components/mobile-sidebar";

export function DocsHeader() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-border border-b bg-background/95 px-4 backdrop-blur md:px-6">
      <MobileSidebar />
      <Link className="font-semibold text-sm tracking-tight" href="/">
        propgate <span className="text-muted-foreground">docs</span>
      </Link>
      <nav className="ml-auto flex items-center gap-4 text-muted-foreground text-xs">
        <DocsSearch />
        <Link className="transition-colors hover:text-foreground" href="/api">
          API
        </Link>
        <a
          className="transition-colors hover:text-foreground"
          href="https://github.com/joaopcm/propgate"
        >
          GitHub
        </a>
      </nav>
    </header>
  );
}
