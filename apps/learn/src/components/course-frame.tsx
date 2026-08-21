import Link from "next/link";
import type { ReactNode } from "react";
import { Spine } from "./spine";

/**
 * The two-column reading frame: the rail on the left, the unit on the right.
 *
 * The rail is hidden below `lg` rather than collapsed behind a disclosure. A
 * course is read in order, so on a phone the useful navigation is "what comes
 * next", which the quiz's footer already provides — a hamburger holding nine
 * links the reader is walking through anyway is chrome for its own sake.
 */
export function CourseFrame({
  children,
  currentSlug,
}: {
  children: ReactNode;
  currentSlug?: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-6xl gap-16 px-6 py-12 lg:px-10 lg:py-20">
      <aside className="hidden w-56 shrink-0 lg:block">
        <div className="sticky top-20">
          <Link
            className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-[0.2em] transition-colors hover:text-foreground"
            href="/"
          >
            propgate / course
          </Link>
          <div className="mt-8">
            <Spine currentSlug={currentSlug} />
          </div>
          <Link
            className="mt-8 block font-mono text-[0.6875rem] text-muted-foreground/60 uppercase tracking-widest transition-colors hover:text-foreground"
            href="/progress"
          >
            Progress
          </Link>
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
