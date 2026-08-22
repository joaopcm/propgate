import { describe, expect, it } from "vitest";
import { abandonedAfterMs } from "./reconcile";

describe("abandonedAfterMs", () => {
  it("exceeds the worst case a live retry chain can take", () => {
    const attempts = 5;
    const timeoutMs = 10_000;
    const worstCase = (2 ** attempts - 1) * 1000 + attempts * timeoutMs;

    expect(abandonedAfterMs(attempts, timeoutMs)).toBeGreaterThan(worstCase);
  });

  it("grows with the attempt count instead of quietly becoming unsafe", () => {
    const five = abandonedAfterMs(5, 10_000);
    const twelve = abandonedAfterMs(12, 10_000);

    expect(twelve).toBeGreaterThan(five);
    expect(twelve).toBeGreaterThan((2 ** 12 - 1) * 1000);
  });

  it("accounts for the timeout as well as the backoff", () => {
    expect(abandonedAfterMs(5, 30_000)).toBeGreaterThan(
      abandonedAfterMs(5, 1000)
    );
  });
});
