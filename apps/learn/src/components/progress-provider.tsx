"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { StoredProgress } from "@/lib/progress";
import { useProgress } from "@/lib/use-progress";

/**
 * One copy of the reader's progress for the whole page.
 *
 * The spine, the gate and the quiz all need it, and the quiz writes to it. Left
 * as three independent `useProgress` calls, passing a unit would update the
 * quiz and leave the rail beside it still showing the unit as unfinished — two
 * components with two opinions about one value, and the one the reader is
 * looking at is whichever they happen to look at.
 *
 * The provider sits in the root layout. A client component with `children`
 * does not make its children client components, so every page below it is
 * still prerendered.
 */

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
