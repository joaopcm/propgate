"use client";

import { useCallback, useState } from "react";

/**
 * Copy one string. The only client JavaScript a `Lookup` needs.
 *
 * The reveal below it is a `<details>` element rather than state, so an
 * exercise still works with scripting off — which matters more here than on
 * most pages, because the exercise is a command the reader takes to a terminal
 * and the page is only where they read it.
 */
const RESET_MS = 1200;

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), RESET_MS);
  }, [value]);

  return (
    <button
      className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-widest transition-colors hover:text-foreground"
      onClick={copy}
      type="button"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}
