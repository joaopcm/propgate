"use client";

import Link from "next/link";
import { useProgressContext } from "@/components/progress-provider";
import { cn } from "@/lib/cn";
import { CURRICULUM } from "@/lib/curriculum";
import { statusFor, type UnitStatus } from "@/lib/progress";

const MARK: Record<UnitStatus, string> = {
  locked: "",
  open: "",
  passed: "passed",
  skipped: "skipped",
};

export function UnitIndex() {
  const { progress } = useProgressContext();

  return (
    <ol className="mt-8 border-border border-t">
      {CURRICULUM.map((unit, index) => {
        const status =
          progress === null ? "locked" : statusFor(unit.slug, progress);

        return (
          <li className="border-border border-b" key={unit.slug}>
            <Link
              className="group flex flex-col gap-2 py-6 sm:flex-row sm:gap-8"
              href={`/units/${unit.slug}`}
            >
              <span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground/60 tracking-widest sm:w-10 sm:pt-2">
                {String(index).padStart(2, "0")}
              </span>
              <span className="flex-1">
                <span className="flex flex-wrap items-baseline gap-3">
                  <span
                    className={cn(
                      "font-display text-2xl leading-tight tracking-tight transition-colors",
                      status === "locked"
                        ? "text-foreground/70 group-hover:text-foreground"
                        : "text-foreground"
                    )}
                  >
                    {unit.title}
                  </span>
                  {MARK[status] === "" ? null : (
                    <span className="font-mono text-[0.625rem] text-muted-foreground/60 uppercase tracking-widest">
                      {MARK[status]}
                    </span>
                  )}
                </span>
                <span className="mt-2 block max-w-[38rem] text-muted-foreground text-sm leading-7">
                  {unit.blurb}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
