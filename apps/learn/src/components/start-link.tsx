"use client";

import Link from "next/link";
import { useProgressContext } from "@/components/progress-provider";
import { CURRICULUM, unitBySlug } from "@/lib/curriculum";
import { resumeSlug, settledCount } from "@/lib/progress";

/**
 * Start, or carry on from wherever the reader stopped.
 *
 * Renders the start state until the browser has been asked, which is the one
 * place the prerendered HTML being wrong is harmless: somebody returning to
 * unit 5 sees "Start with unit 00" for a frame and then sees their own place.
 * The reverse — a first-time reader briefly told to resume something — would be
 * confusing rather than merely stale.
 */
export function StartLink() {
  const { progress } = useProgressContext();
  const slug = progress === null ? "" : resumeSlug(progress);
  const done = progress === null ? 0 : settledCount(progress);
  const resuming = done > 0 && done < CURRICULUM.length;
  const target =
    progress === null ? CURRICULUM[0] : (unitBySlug(slug) ?? CURRICULUM[0]);

  if (target === undefined) {
    return null;
  }

  return (
    <div className="mt-10 flex flex-wrap items-baseline gap-6">
      <Link
        className="border border-mark px-5 py-2.5 font-mono text-[0.6875rem] text-mark uppercase tracking-widest transition-colors hover:bg-mark hover:text-background"
        href={`/units/${target.slug}`}
      >
        {resuming ? "Carry on" : "Start"} — {target.title}
      </Link>
      {done === 0 ? null : (
        <Link
          className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-widest underline underline-offset-4 transition-colors hover:text-foreground"
          href="/progress"
        >
          {done} of {CURRICULUM.length} settled
        </Link>
      )}
    </div>
  );
}
