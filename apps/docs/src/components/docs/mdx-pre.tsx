import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

export function MdxPre({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"pre">) {
  return (
    <div className="my-4 overflow-x-auto border border-border bg-muted text-sm leading-6">
      <pre className={cn("p-4", className)} {...props}>
        {children}
      </pre>
    </div>
  );
}
