"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/cn";

export interface RenderedTab {
  readonly code: string;
  readonly html: string;
  readonly label: string;
}

function TabButton({
  active,
  index,
  label,
  onSelect,
}: {
  active: boolean;
  index: number;
  label: string;
  onSelect: (index: number) => void;
}) {
  const handleClick = useCallback(() => onSelect(index), [index, onSelect]);

  return (
    <button
      className={cn(
        "cursor-pointer px-2 py-1.5 text-xs transition-colors",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
      onClick={handleClick}
      type="button"
    >
      {label}
    </button>
  );
}

export function CodeTabsClient({ items }: { items: readonly RenderedTab[] }) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const current = items[active] ?? items[0];

  const handleCopy = useCallback(async () => {
    if (current === undefined) {
      return;
    }

    await navigator.clipboard.writeText(current.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [current]);

  if (current === undefined) {
    return null;
  }

  return (
    <div className="my-4 border border-border bg-muted">
      <div className="flex items-center gap-1 border-border border-b px-2">
        {items.map((item, index) => (
          <TabButton
            active={index === active}
            index={index}
            key={item.label}
            label={item.label}
            onSelect={setActive}
          />
        ))}
        <button
          className="ml-auto cursor-pointer px-2 py-1.5 text-muted-foreground text-xs hover:text-foreground"
          onClick={handleCopy}
          type="button"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div
        className="overflow-x-auto text-sm leading-6 [&_pre]:p-4"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output, from literals in this repo
        dangerouslySetInnerHTML={{ __html: current.html }}
      />
    </div>
  );
}
