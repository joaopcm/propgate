"use client";

import { useCallback, useRef, useState } from "react";
import { useProgressContext } from "@/components/progress-provider";
import { CURRICULUM } from "@/lib/curriculum";
import {
  clearProgress,
  EMPTY_PROGRESS,
  exportProgress,
  importProgress,
  settledCount,
} from "@/lib/progress";

/**
 * Where the progress lives, said plainly, with the two buttons that make the
 * answer survivable.
 *
 * A course with no account has one honest failure mode: clear the browser's
 * storage and nine units of work is gone. Export and import do not remove it,
 * they make it the reader's problem to solve rather than a surprise — which is
 * the most this design can offer and more than a silent `localStorage` write
 * usually does.
 */
export function ProgressNote() {
  const { progress, update } = useProgressContext();
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(() => {
    const imported = importProgress(input.current?.value ?? "");

    if (imported === null) {
      setMessage("That is not progress this version understands.");

      return;
    }

    update(imported);
    setMessage("Imported.");
  }, [update]);

  const reset = useCallback(() => {
    clearProgress();
    update(EMPTY_PROGRESS);
    setMessage("Cleared.");
  }, [update]);

  if (progress === null) {
    return <div className="h-48" />;
  }

  return (
    <section className="max-w-xl">
      <h1 className="font-display text-4xl leading-[1.1] tracking-tight">
        Your progress
      </h1>
      <p className="mt-4 text-muted-foreground leading-7">
        {settledCount(progress)} of {CURRICULUM.length} units settled. It is
        stored in this browser under one key and sent nowhere. There is no
        account, which means nothing to sign up for and nothing to lose if this
        site disappears — and it also means clearing site data clears this.
      </p>

      <div className="mt-8 border-border border-t pt-6">
        <p className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-widest">
          Take it with you
        </p>
        <pre className="mt-3 max-h-48 overflow-auto border border-border bg-muted p-3 font-mono text-[0.75rem] leading-5">
          {exportProgress(progress)}
        </pre>
      </div>

      <div className="mt-8 border-border border-t pt-6">
        <label
          className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-widest"
          htmlFor="import"
        >
          Paste it back
        </label>
        <textarea
          className="mt-3 h-24 w-full border border-border bg-muted p-3 font-mono text-[0.75rem] leading-5"
          id="import"
          ref={input}
        />
        <div className="mt-3 flex flex-wrap items-center gap-6">
          <button
            className="font-mono text-[0.6875rem] text-foreground uppercase tracking-widest underline underline-offset-4"
            onClick={load}
            type="button"
          >
            Import
          </button>
          <button
            className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-widest underline underline-offset-4 transition-colors hover:text-[var(--color-destructive)]"
            onClick={reset}
            type="button"
          >
            Start over
          </button>
        </div>
        {message === null ? null : (
          <p className="mt-3 text-muted-foreground text-sm">{message}</p>
        )}
      </div>
    </section>
  );
}
