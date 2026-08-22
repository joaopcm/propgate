"use client";

import Link from "next/link";
import { useProgressContext } from "@/components/progress-provider";
import { cn } from "@/lib/cn";
import { CURRICULUM } from "@/lib/curriculum";
import { examUnlocked, statusFor, type UnitStatus } from "@/lib/progress";

const NODE_STYLE: Record<UnitStatus, string> = {
  locked: "border-border",
  open: "border-muted-foreground",
  passed: "border-mark bg-mark",
  skipped: "border-mark border-dashed",
};

const LABEL_STYLE: Record<UnitStatus, string> = {
  locked: "text-muted-foreground/50",
  open: "text-muted-foreground",
  passed: "text-muted-foreground",
  skipped: "text-muted-foreground",
};

function Node({ active, status }: { active: boolean; status: UnitStatus }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-[0.45rem] size-2 shrink-0 rounded-full border transition-colors",
        NODE_STYLE[status],
        active && "border-mark bg-mark"
      )}
    />
  );
}

export function Spine({ currentSlug }: { currentSlug?: string }) {
  const { progress } = useProgressContext();

  return (
    <nav aria-label="Course units" className="relative flex flex-col gap-1">
      <span
        aria-hidden
        className="spine-rule absolute top-2 bottom-2 left-1 w-px bg-border"
      />
      {CURRICULUM.map((unit, index) => {
        const status =
          progress === null ? "locked" : statusFor(unit.slug, progress);
        const active = unit.slug === currentSlug;
        const reachable = status !== "locked" || active;

        return (
          <div className="relative flex gap-3 pl-0" key={unit.slug}>
            <Node active={active} status={status} />
            {reachable ? (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "py-1 text-sm leading-snug transition-colors hover:text-foreground",
                  active ? "text-foreground" : LABEL_STYLE[status]
                )}
                href={`/units/${unit.slug}`}
              >
                <span className="font-mono text-[0.6875rem] text-muted-foreground/60">
                  {String(index).padStart(2, "0")}
                </span>{" "}
                {unit.title}
              </Link>
            ) : (
              <span
                className={cn("py-1 text-sm leading-snug", LABEL_STYLE[status])}
              >
                <span className="font-mono text-[0.6875rem] text-muted-foreground/40">
                  {String(index).padStart(2, "0")}
                </span>{" "}
                {unit.title}
              </span>
            )}
          </div>
        );
      })}
      <div className="relative mt-3 flex gap-3">
        <Node
          active={currentSlug === "exam"}
          status={
            progress !== null && examUnlocked(progress) ? "open" : "locked"
          }
        />
        {progress !== null && examUnlocked(progress) ? (
          <Link
            className="py-1 font-display text-base transition-colors hover:text-foreground"
            href="/exam"
          >
            The exam
          </Link>
        ) : (
          <span className="py-1 font-display text-base text-muted-foreground/50">
            The exam
          </span>
        )}
      </div>
    </nav>
  );
}
