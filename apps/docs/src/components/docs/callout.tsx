import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Callout({
  children,
  kind = "note",
}: {
  children: ReactNode;
  kind?: "note" | "warning";
}) {
  return (
    <aside
      className={cn(
        "my-4 border-l-2 px-4 py-2 text-sm leading-7",
        kind === "warning"
          ? "border-[var(--color-warning)] text-foreground"
          : "border-rule text-muted-foreground"
      )}
    >
      {children}
    </aside>
  );
}
