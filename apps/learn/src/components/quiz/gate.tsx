"use client";

import Link from "next/link";
import { type ReactNode, useCallback } from "react";
import { useProgressContext } from "@/components/progress-provider";
import { CURRICULUM, unitBySlug, unitIndex } from "@/lib/curriculum";
import { recordUnit, statusFor } from "@/lib/progress";

export function Gate({
  children,
  slug,
}: {
  children: ReactNode;
  slug: string;
}) {
  const { progress, update } = useProgressContext();

  const skip = useCallback(() => {
    if (progress === null) {
      return;
    }

    update(recordUnit(progress, slug, "skipped", 0, new Date().toISOString()));
  }, [progress, slug, update]);

  if (progress === null) {
    return null;
  }

  if (statusFor(slug, progress) !== "locked") {
    return <>{children}</>;
  }

  const index = unitIndex(slug);
  const previous = index > 0 ? CURRICULUM[index - 1] : undefined;
  const unit = unitBySlug(slug);

  return (
    <div className="rise-in max-w-xl">
      <p className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-[0.2em]">
        Unit {String(index).padStart(2, "0")} — locked
      </p>
      <h1 className="mt-3 font-display text-4xl leading-[1.1] tracking-tight">
        {unit?.title}
      </h1>
      <p className="mt-4 text-muted-foreground leading-7">
        {previous === undefined
          ? "An earlier unit has to be finished first."
          : `This one builds on ${previous.title}, and its questions have not been answered yet.`}
      </p>
      <p className="mt-4 text-muted-foreground/70 text-sm leading-7">
        {unit?.assumes}
      </p>
      <div className="mt-8 flex flex-col gap-4 border-border border-t pt-6">
        {previous === undefined ? null : (
          <Link
            className="font-mono text-[0.6875rem] text-foreground uppercase tracking-widest underline underline-offset-4"
            href={`/units/${previous.slug}`}
          >
            Go to {previous.title}
          </Link>
        )}
        <button
          className="text-left font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-widest underline underline-offset-4 transition-colors hover:text-foreground"
          onClick={skip}
          type="button"
        >
          Open it anyway
        </button>
        <p className="text-muted-foreground/60 text-xs leading-6">
          Opening it anyway records this unit as skipped rather than passed. The
          rail keeps showing the difference, and the exam still draws questions
          from it.
        </p>
      </div>
    </div>
  );
}
