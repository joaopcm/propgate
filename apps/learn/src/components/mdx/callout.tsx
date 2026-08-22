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
        "my-6 border-l-2 px-4 py-1 text-[0.9375rem] leading-7",
        kind === "warning"
          ? "border-[var(--color-warning)] text-foreground/85"
          : "border-rule text-muted-foreground"
      )}
    >
      {children}
    </aside>
  );
}
