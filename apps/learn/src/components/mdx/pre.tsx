import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

export function Pre({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"pre">) {
  return (
    <div className="my-6 overflow-x-auto border border-border bg-muted text-[0.8125rem] leading-6">
      <pre className={cn("p-4", className)} {...props}>
        {children}
      </pre>
    </div>
  );
}
