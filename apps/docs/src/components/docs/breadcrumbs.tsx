"use client";

import { usePathname } from "next/navigation";
import { findNavEntry } from "@/lib/navigation";

export function Breadcrumbs() {
  const entry = findNavEntry(usePathname());

  if (entry === undefined) {
    return null;
  }

  return (
    <p className="mb-3 text-muted-foreground text-xs">
      {entry.section}
      {entry.group ? ` › ${entry.group}` : ""} › {entry.title}
    </p>
  );
}
