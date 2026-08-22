import { CURRICULUM } from "./curriculum";

export const PROGRESS_KEY = "propgate.learn.progress.v1";

export const PROGRESS_VERSION = 1;

export type UnitOutcome = "passed" | "skipped";

export interface StoredUnit {
  readonly at: string;
  readonly attempts: number;
  readonly outcome: UnitOutcome;
}

export interface StoredExam {
  readonly at: string;
  readonly attempts: number;
}

export interface StoredProgress {
  readonly exam?: StoredExam;
  readonly units: Readonly<Record<string, StoredUnit>>;
  readonly version: number;
}

export type UnitStatus = "locked" | "open" | UnitOutcome;

export const EMPTY_PROGRESS: StoredProgress = {
  units: {},
  version: PROGRESS_VERSION,
};

function isStoredUnit(value: unknown): value is StoredUnit {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<StoredUnit>;

  return (
    typeof candidate.at === "string" &&
    typeof candidate.attempts === "number" &&
    (candidate.outcome === "passed" || candidate.outcome === "skipped")
  );
}

export function parseProgress(raw: string | null): StoredProgress {
  if (raw === null) {
    return EMPTY_PROGRESS;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== "object" || parsed === null) {
      return EMPTY_PROGRESS;
    }

    const candidate = parsed as Partial<StoredProgress>;

    if (candidate.version !== PROGRESS_VERSION) {
      return EMPTY_PROGRESS;
    }

    const units: Record<string, StoredUnit> = {};

    for (const [slug, value] of Object.entries(candidate.units ?? {})) {
      if (isStoredUnit(value)) {
        units[slug] = value;
      }
    }

    return {
      ...(candidate.exam === undefined ? {} : { exam: candidate.exam }),
      units,
      version: PROGRESS_VERSION,
    };
  } catch {
    return EMPTY_PROGRESS;
  }
}

export function readProgress(): StoredProgress {
  if (typeof window === "undefined") {
    return EMPTY_PROGRESS;
  }

  return parseProgress(window.localStorage.getItem(PROGRESS_KEY));
}

export function writeProgress(progress: StoredProgress): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

export function clearProgress(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(PROGRESS_KEY);
}

export function recordUnit(
  progress: StoredProgress,
  slug: string,
  outcome: UnitOutcome,
  attempts: number,
  at: string
): StoredProgress {
  const existing = progress.units[slug];

  if (existing?.outcome === "passed" && outcome === "skipped") {
    return progress;
  }

  return {
    ...progress,
    units: { ...progress.units, [slug]: { at, attempts, outcome } },
  };
}

export function recordExam(
  progress: StoredProgress,
  attempts: number,
  at: string
): StoredProgress {
  return { ...progress, exam: { at, attempts } };
}

export function clearExam(progress: StoredProgress): StoredProgress {
  const { exam, ...rest } = progress;

  return rest;
}

export function statusFor(slug: string, progress: StoredProgress): UnitStatus {
  const stored = progress.units[slug];

  if (stored !== undefined) {
    return stored.outcome;
  }

  const index = CURRICULUM.findIndex((unit) => unit.slug === slug);

  if (index === -1) {
    return "locked";
  }

  if (index === 0) {
    return "open";
  }

  const previous = CURRICULUM[index - 1];

  if (previous === undefined) {
    return "locked";
  }

  return progress.units[previous.slug] === undefined ? "locked" : "open";
}

export function isSettled(status: UnitStatus): boolean {
  return status === "passed" || status === "skipped";
}

export function examUnlocked(progress: StoredProgress): boolean {
  return CURRICULUM.every((unit) => progress.units[unit.slug] !== undefined);
}

export function resumeSlug(progress: StoredProgress): string {
  const next = CURRICULUM.find(
    (unit) => progress.units[unit.slug] === undefined
  );
  const [first] = CURRICULUM;

  return next?.slug ?? first?.slug ?? "";
}

export function settledCount(progress: StoredProgress): number {
  return CURRICULUM.filter((unit) => progress.units[unit.slug] !== undefined)
    .length;
}

export function exportProgress(progress: StoredProgress): string {
  return JSON.stringify(progress, null, 2);
}

export function importProgress(text: string): StoredProgress | null {
  try {
    const parsed: unknown = JSON.parse(text);

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    if ((parsed as Partial<StoredProgress>).version !== PROGRESS_VERSION) {
      return null;
    }

    return parseProgress(text);
  } catch {
    return null;
  }
}
