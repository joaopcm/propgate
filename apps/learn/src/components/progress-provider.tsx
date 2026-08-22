"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { StoredProgress } from "@/lib/progress";
import { useProgress } from "@/lib/use-progress";

interface ProgressContext {
  progress: StoredProgress | null;
  update: (next: StoredProgress) => void;
}

const Context = createContext<ProgressContext | null>(null);

export function ProgressProvider({ children }: { children: ReactNode }) {
  return <Context.Provider value={useProgress()}>{children}</Context.Provider>;
}

export function useProgressContext(): ProgressContext {
  const value = useContext(Context);

  if (value === null) {
    throw new Error("useProgressContext used outside ProgressProvider");
  }

  return value;
}
