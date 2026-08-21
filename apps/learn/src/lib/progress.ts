import { CURRICULUM } from "./curriculum";

/**
 * Where the reader is, and nowhere else.
 *
 * There is no account and no server. That is a decision rather than a
 * shortcut: a course that asked somebody to sign up before the first unit is a
 * course fewer people start, and nothing here is worth the cost of holding
 * somebody's email address.
 *
 * The trade is honest and stated in the UI: clear the browser's storage and
 * the progress is gone. `exportProgress` and `importProgress` exist so that is
 * recoverable by anyone who cares to, rather than merely regrettable.
 */

/**
 * The schema version is in the key, not only in the value.
 *
 * A later schema writes `…v2` and finds nothing, so a reader on a new version
 * starts clean instead of having old data reinterpreted under new rules. The
 * v1 key is left where it is rather than migrated or deleted — migrating
 * quiz progress is a lot of care spent on something whose worst case is
 * re-reading a unit.
 */
export const PROGRESS_KEY = "propgate.learn.progress.v1";

export const PROGRESS_VERSION = 1;

/**
 * How a unit was left, and the two are not the same thing.
 *
 * `passed` means every question was answered correctly. `skipped` means the
 * reader used the escape hatch on the locked screen. Both open the next unit —
 * an escape hatch that does not let you out is not one — but they are stored
 * apart and rendered apart, permanently.
 *
 * Collapsing them would be the course telling the same kind of lie the product
 * exists to catch: a green tick asserting something nobody verified. Invariant
 * 3 applied to a reader's own record of what they did.
 */
export type UnitOutcome = "passed" | "skipped";

export interface StoredUnit {
  readonly at: string;
  /**
   * Wrong answers before the unit passed. Zero for a skip.
   *
   * Shown, never scored. A reader who needed four attempts learned the same
   * material as one who needed none, and a number that gated anything would be
   * a threshold nobody measured.
   */
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

/**
 * Parse, or give up and start clean.
 *
 * Deliberately strict about the version and deliberately silent about a
 * failure. The only thing at stake is whether somebody re-reads a unit, so a
 * thrown error or a console warning would both be louder than the problem.
 * Anything that does not parse is treated as absent.
 */
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

/**
 * Reading during a build returns empty rather than throwing.
 *
 * Every route here is prerendered, so this module is evaluated once with no
 * `window` in sight. The cover renders its "start" state, and the client
 * corrects it on mount.
 */
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

/**
 * Record an outcome, keeping the stronger of the two.
 *
 * A reader who skipped a unit and later came back and passed its quiz has
 * passed it, and the record should say so. The reverse is not true: passing
 * cannot be downgraded by a later skip, because there is nothing a skip
 * establishes that passing did not.
 */
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

/**
 * Failing the exam resets the exam and nothing else.
 *
 * Clearing unit progress on a failed final would be punitive in a course
 * nobody is grading, and it would punish exactly the reader who is engaging
 * with it most.
 */
export function clearExam(progress: StoredProgress): StoredProgress {
  const { exam, ...rest } = progress;

  return rest;
}

/**
 * Locked, open, or done — derived, never stored.
 *
 * Storing a `locked` flag would mean two places could disagree about whether a
 * unit is reachable, and the one that was wrong would be the one the reader
 * saw. The rule is small enough to compute: unit 0 is always open, and any
 * other unit is open once the one before it has an outcome of either kind.
 */
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

/** Whether every unit has an outcome, which is what opens the exam. */
export function examUnlocked(progress: StoredProgress): boolean {
  return CURRICULUM.every((unit) => progress.units[unit.slug] !== undefined);
}

/** The unit to send somebody to when they arrive. */
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

/**
 * Null when the text is not progress this version understands.
 *
 * Validated here rather than by comparing the result of `parseProgress` against
 * `EMPTY_PROGRESS`: that comparison happens to work by object identity today
 * and would break the moment the empty case returned a fresh object. An import
 * is a paste from a file somebody has had the chance to edit, so it is the one
 * caller that wants to know the difference between "no progress" and "not
 * progress".
 */
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
