"use client";

import { useCallback, useState } from "react";
import { DocsSidebar } from "@/components/docs-sidebar";

export function MobileSidebar() {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((isOpen) => !isOpen), []);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className="md:hidden">
      <button
        aria-expanded={open}
        aria-label="Toggle documentation navigation"
        className="px-2 py-1 text-muted-foreground text-xs hover:text-foreground"
        onClick={toggle}
        type="button"
      >
        Menu
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-14 max-h-[70vh] overflow-y-auto border-border/80 border-b bg-background">
          <DocsSidebar onNavigate={close} />
        </div>
      ) : null}
    </div>
  );
}
