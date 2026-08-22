"use client";

import { useCallback, useState } from "react";

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
