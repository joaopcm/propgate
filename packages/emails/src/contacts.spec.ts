import { describe, expect, it } from "vitest";
import { bounded, createRecordingContactList } from "./contacts";

/**
 * The bound on a contact add.
 *
 * Tested here rather than through `createContactList`, which would mean either a
 * live call into the production segment or a stubbed `fetch`. `bounded` is the
 * whole of the risky logic and it is pure, so there is nothing left to learn from
 * doing either.
 *
 * The reason it exists at all is in `contacts.ts`: this call is awaited inline in
 * `POST /v1/signup/confirm` after the OTP has been spent, and the Resend SDK
 * brings no timeout of its own.
 */

const NEVER = new Promise<string>(() => {
  // Deliberately never settles: a Resend connection that is accepted and then
  // stalls looks exactly like this from here.
});

/** Long enough to outlive every bound in this file. */
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
    // The failure this whole mechanism exists for. Without it the caller waits
    // on the operating system's socket timeout, minutes away, holding open a
    // request whose code is already dead.
    await expect(bounded(NEVER, 10)).resolves.toEqual({ kind: "timedout" });
  });

  it("reports a rejection rather than throwing it", async () => {
    const outcome = await bounded(
      Promise.reject(new Error("segment not found")),
      50
    );

    // `add` turns every one of these into `kind: "failed"`, so a throw here would
    // escape the one place meant to absorb it and surface as a 500 on a
    // confirmation whose code has already been spent.
    expect(outcome).toEqual({
      cause: new Error("segment not found"),
      kind: "threw",
    });
  });

  it("swallows work that rejects after losing the race", async () => {
    /**
     * A characterisation rather than a regression test, and worth being explicit
     * about which: `Promise.race` subscribes to every entry, so a loser that
     * rejects later is already handled and this passes against every spelling of
     * `bounded` tried so far — including a deliberately naive one. It is here to
     * pin the property for whoever rewrites this with an `AbortController` and a
     * hand-rolled subscription, which is where the leak would actually appear.
     *
     * The event is watched directly because the runner will not surface it: vitest
     * keeps its own `unhandledRejection` handler installed.
     */
    const unhandled: unknown[] = [];
    const record = (cause: unknown) => unhandled.push(cause);

    process.on("unhandledRejection", record);

    try {
      const late = tick(AFTER_THE_RACE_MS / 2).then(() => {
        throw new Error("too late");
      });

      await expect(bounded(late, 5)).resolves.toEqual({ kind: "timedout" });
      // Past the point the abandoned work rejects, which is when the event fires.
      await tick(AFTER_THE_RACE_MS);
    } finally {
      process.off("unhandledRejection", record);
    }

    expect(unhandled).toEqual([]);
  });

  it("does not hold the event loop open after it settles", async () => {
    // A pending `setTimeout` keeps a process alive. Invisible in a server, and in
    // a test run it is a suite that hangs instead of exiting — which is why the
    // timer is cleared in a `finally` rather than left to expire.
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

    // The attempt is recorded either way: a spec asserting "the key still comes
    // back when the list is down" needs to know the call actually happened, or it
    // would pass just as well against a route that skipped it.
    await expect(list.add({ email: "someone@example.com" })).resolves.toEqual({
      error: "list down",
      kind: "failed",
    });
    expect(list.added).toHaveLength(1);
  });
});
