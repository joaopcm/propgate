import { describe, expect, it } from "vitest";
import { bounded, createRecordingContactList } from "./contacts";

const NEVER = new Promise<string>(() => {
  // never settles
});

const AFTER_THE_RACE_MS = 40;

function tick(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("bounded", () => {
  it("gives back what settled in time", async () => {
    await expect(bounded(Promise.resolve("added"), 50)).resolves.toEqual({
      kind: "settled",
      value: "added",
    });
  });

  it("gives up on work that never settles", async () => {
    await expect(bounded(NEVER, 10)).resolves.toEqual({ kind: "timedout" });
  });

  it("reports a rejection rather than throwing it", async () => {
    const outcome = await bounded(
      Promise.reject(new Error("segment not found")),
      50
    );

    expect(outcome).toEqual({
      cause: new Error("segment not found"),
      kind: "threw",
    });
  });

  it("swallows work that rejects after losing the race", async () => {
    const unhandled: unknown[] = [];
    const record = (cause: unknown) => unhandled.push(cause);

    process.on("unhandledRejection", record);

    try {
      const late = tick(AFTER_THE_RACE_MS / 2).then(() => {
        throw new Error("too late");
      });

      await expect(bounded(late, 5)).resolves.toEqual({ kind: "timedout" });
      await tick(AFTER_THE_RACE_MS);
    } finally {
      process.off("unhandledRejection", record);
    }

    expect(unhandled).toEqual([]);
  });

  it("does not hold the event loop open after it settles", async () => {
    const before = process.getActiveResourcesInfo().length;

    await bounded(Promise.resolve("added"), 60_000);

    expect(process.getActiveResourcesInfo().length).toBe(before);
  });
});

describe("createRecordingContactList", () => {
  it("keeps what it was asked to add", async () => {
    const list = createRecordingContactList();

    await list.add({ email: "someone@example.com" });

    expect(list.added).toEqual([{ email: "someone@example.com" }]);
  });

  it("fails on demand, and still records the attempt", async () => {
    const list = createRecordingContactList({ failWith: "list down" });

    await expect(list.add({ email: "someone@example.com" })).resolves.toEqual({
      error: "list down",
      kind: "failed",
    });
    expect(list.added).toHaveLength(1);
  });
});
