"use client";

import { useCallback, useEffect, useState } from "react";
import { readProgress, type StoredProgress, writeProgress } from "./progress";

/**
 * The reader's progress, once the browser has been asked.
 *
 * `null` until the effect runs, and every caller has to handle it. That is
 * deliberate and it is the whole reason this hook exists rather than a
 * `useState(readProgress())`.
 *
 * Every page here is prerendered, so the HTML on disk was built with no
 * progress at all. A component that assumed the empty value would paint "unit
 * 4 is locked" to somebody who finished it last week, then correct itself a
 * frame later — and the reverse flash, content appearing and then being
 * replaced by a locked panel, is worse. One quiet frame is the honest cost of
 * having no server.
 */
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
