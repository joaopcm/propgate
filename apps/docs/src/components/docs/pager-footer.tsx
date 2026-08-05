"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { pagerFor } from "@/lib/pager";

export function PagerFooter() {
  const { next, previous } = pagerFor(usePathname());

  if (next === undefined && previous === undefined) {
    return null;
  }

  return (
    <nav className="mt-12 flex justify-between gap-4 border-border/80 border-t pt-6 text-sm">
      {previous ? (
        <Link
          className="text-muted-foreground hover:text-foreground"
          href={previous.href}
        >
          ← {previous.title}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          className="ml-auto text-muted-foreground hover:text-foreground"
          href={next.href}
        >
          {next.title} →
        </Link>
      ) : null}
    </nav>
  );
}
