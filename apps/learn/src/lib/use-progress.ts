"use client";

import { useCallback, useEffect, useState } from "react";
import { readProgress, type StoredProgress, writeProgress } from "./progress";

export function useProgress(): {
  progress: StoredProgress | null;
  update: (next: StoredProgress) => void;
} {
  const [progress, setProgress] = useState<StoredProgress | null>(null);

  useEffect(() => {
    setProgress(readProgress());
  }, []);

  const update = useCallback((next: StoredProgress) => {
    writeProgress(next);
    setProgress(next);
  }, []);

  return { progress, update };
}
