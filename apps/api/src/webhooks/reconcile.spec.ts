import { describe, expect, it } from "vitest";
import { abandonedAfterMs } from "./reconcile";

/**
 * The one number in the reconciler, and why it is derived.
 *
 * A row being retried right now is also `pending`. Re-enqueueing it beside a live
 * job delivers the same event twice, and nothing downstream catches that —
 * `attemptDelivery` skips *settled* rows, and a row mid-retry is not settled. So
 * the window must always exceed the worst case a live retry chain can take.
 */

describe("abandonedAfterMs", () => {
  it("exceeds the worst case a live retry chain can take", () => {
    // Five attempts of 1s-doubling backoff is 31s of waiting, plus five 10s
    // timeouts, so roughly 81s. Anything at or below that could double-send.
    const attempts = 5;
    const timeoutMs = 10_000;
    const worstCase = (2 ** attempts - 1) * 1000 + attempts * timeoutMs;

    expect(abandonedAfterMs(attempts, timeoutMs)).toBeGreaterThan(worstCase);
  });

  it("grows with the attempt count instead of quietly becoming unsafe", () => {
    // The reason this is computed rather than a constant. Raising WEBHOOK_ATTEMPTS
    // lengthens the retry chain exponentially; a fixed fifteen-minute window would
    // silently start double-sending somewhere around eleven attempts.
    const five = abandonedAfterMs(5, 10_000);
    const twelve = abandonedAfterMs(12, 10_000);

    expect(twelve).toBeGreaterThan(five);
    expect(twelve).toBeGreaterThan((2 ** 12 - 1) * 1000);
  });

  it("accounts for the timeout as well as the backoff", () => {
    // An attempt can burn its full timeout before the backoff even starts. Ignoring
    // that is how the window ends up just barely too short.
    expect(abandonedAfterMs(5, 30_000)).toBeGreaterThan(
      abandonedAfterMs(5, 1000)
    );
  });
});
