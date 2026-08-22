import { describe, expect, it } from "vitest";
import { CURRICULUM } from "./curriculum";
import {
  clearExam,
  EMPTY_PROGRESS,
  examUnlocked,
  exportProgress,
  importProgress,
  isSettled,
  PROGRESS_VERSION,
  parseProgress,
  recordExam,
  recordUnit,
  resumeSlug,
  type StoredProgress,
  settledCount,
  statusFor,
} from "./progress";

const AT = "2026-08-21T00:00:00.000Z";

function slugAt(index: number): string {
  const unit = CURRICULUM[index];

  if (unit === undefined) {
    throw new Error(`no unit at index ${index}`);
  }

  return unit.slug;
}

function allSettled(): StoredProgress {
  return CURRICULUM.reduce<StoredProgress>(
    (progress, unit) => recordUnit(progress, unit.slug, "passed", 0, AT),
    EMPTY_PROGRESS
  );
}

describe("parsing stored progress", () => {
  it("treats absent storage as empty", () => {
    expect(parseProgress(null)).toEqual(EMPTY_PROGRESS);
  });

  it("treats unparseable text as empty", () => {
    expect(parseProgress("{not json")).toEqual(EMPTY_PROGRESS);
  });

  it("ignores a payload from another schema version rather than migrating it", () => {
    const foreign = JSON.stringify({
      units: {
        "the-last-twenty-percent": { at: AT, attempts: 0, outcome: "passed" },
      },
      version: 99,
    });

    expect(parseProgress(foreign)).toEqual(EMPTY_PROGRESS);
  });

  it("drops a unit entry that is not shaped like one", () => {
    const damaged = JSON.stringify({
      units: {
        bad: { outcome: "excellent" },
        good: { at: AT, attempts: 1, outcome: "passed" },
      },
      version: PROGRESS_VERSION,
    });

    expect(Object.keys(parseProgress(damaged).units)).toEqual(["good"]);
  });
});

describe("recording an outcome", () => {
  it("stores a pass with its attempt count", () => {
    const progress = recordUnit(EMPTY_PROGRESS, "unit", "passed", 3, AT);

    expect(progress.units.unit).toEqual({
      at: AT,
      attempts: 3,
      outcome: "passed",
    });
  });

  it("keeps a skip distinguishable from a pass", () => {
    const progress = recordUnit(EMPTY_PROGRESS, "unit", "skipped", 0, AT);

    expect(progress.units.unit).toMatchObject({ outcome: "skipped" });
    expect(isSettled("skipped")).toBe(true);
  });

  it("upgrades a skip to a pass", () => {
    const skipped = recordUnit(EMPTY_PROGRESS, "unit", "skipped", 0, AT);
    const passed = recordUnit(skipped, "unit", "passed", 2, AT);

    expect(passed.units.unit).toMatchObject({ outcome: "passed" });
  });

  it("never downgrades a pass to a skip", () => {
    const passed = recordUnit(EMPTY_PROGRESS, "unit", "passed", 0, AT);
    const after = recordUnit(passed, "unit", "skipped", 0, AT);

    expect(after.units.unit).toMatchObject({ outcome: "passed" });
  });
});

describe("what is locked", () => {
  it("opens the first unit with no progress at all", () => {
    expect(statusFor(slugAt(0), EMPTY_PROGRESS)).toBe("open");
  });

  it("locks the second unit until the first has an outcome", () => {
    expect(statusFor(slugAt(1), EMPTY_PROGRESS)).toBe("locked");
  });

  it("opens the next unit after a pass", () => {
    const progress = recordUnit(EMPTY_PROGRESS, slugAt(0), "passed", 0, AT);

    expect(statusFor(slugAt(1), progress)).toBe("open");
  });

  it("opens the next unit after a skip", () => {
    const progress = recordUnit(EMPTY_PROGRESS, slugAt(0), "skipped", 0, AT);

    expect(statusFor(slugAt(1), progress)).toBe("open");
  });

  it("does not open a unit two ahead", () => {
    const progress = recordUnit(EMPTY_PROGRESS, slugAt(0), "passed", 0, AT);

    expect(statusFor(slugAt(2), progress)).toBe("locked");
  });

  it("locks a slug it has never heard of", () => {
    expect(statusFor("no-such-unit", EMPTY_PROGRESS)).toBe("locked");
  });
});

describe("the exam", () => {
  it("stays locked until every unit has an outcome", () => {
    const progress = recordUnit(EMPTY_PROGRESS, slugAt(0), "passed", 0, AT);

    expect(examUnlocked(progress)).toBe(false);
  });

  it("unlocks once every unit has one", () => {
    expect(examUnlocked(allSettled())).toBe(true);
  });

  it("resets itself and leaves the units alone", () => {
    const attempted = recordExam(allSettled(), 2, AT);
    const reset = clearExam(attempted);

    expect(reset.exam).toBeUndefined();
    expect(settledCount(reset)).toBe(CURRICULUM.length);
  });
});

describe("where to send somebody", () => {
  it("starts at the first unit", () => {
    expect(resumeSlug(EMPTY_PROGRESS)).toBe(slugAt(0));
  });

  it("resumes at the first unit with no outcome", () => {
    const progress = recordUnit(EMPTY_PROGRESS, slugAt(0), "passed", 0, AT);

    expect(resumeSlug(progress)).toBe(slugAt(1));
  });

  it("falls back to the first unit when everything is done", () => {
    expect(resumeSlug(allSettled())).toBe(slugAt(0));
  });
});

describe("taking progress somewhere else", () => {
  it("round trips", () => {
    const progress = recordExam(allSettled(), 1, AT);
    const imported = importProgress(exportProgress(progress));

    expect(imported).toEqual(progress);
  });

  it("refuses text that is not progress", () => {
    expect(importProgress("hello")).toBeNull();
    expect(importProgress("[]")).toBeNull();
    expect(importProgress('{"version":99,"units":{}}')).toBeNull();
  });

  it("accepts an export with no units in it", () => {
    expect(importProgress(exportProgress(EMPTY_PROGRESS))).toEqual(
      EMPTY_PROGRESS
    );
  });
});
