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

/**
 * The nine units on the cover, with their blurbs.
 *
 * Every unit is a link here, including the locked ones, and that is on purpose:
 * a reader deciding whether the course is worth their evening needs to see what
 * is in it. The gate is on the unit page, where it can offer the escape hatch.
 * A cover that hid seven of nine titles behind a lock would be selling rather
 * than describing.
 */
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
