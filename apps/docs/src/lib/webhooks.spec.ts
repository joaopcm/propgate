import { TOLERANCE_SECONDS, WEBHOOK_EVENTS } from "@propgate/webhooks";
import { describe, expect, it } from "vitest";
import { EVENTS, TIMESTAMP_TOLERANCE_SECONDS } from "./webhooks";

/**
 * The published webhook reference against the code it describes.
 *
 * `Record<WebhookEvent, …>` already makes a missing entry a `tsc` error. These
 * cover what the type cannot.
 */

describe("the event reference", () => {
  it("documents every event the product can send", () => {
    expect(Object.keys(EVENTS).toSorted()).toEqual(
      [...WEBHOOK_EVENTS].toSorted()
    );
  });

  it("says both what each event means and when it fires", () => {
    // "When does this arrive" is the question an integrator has, and a summary
    // alone does not answer it.
    for (const [event, doc] of Object.entries(EVENTS)) {
      expect(doc.summary.length, event).toBeGreaterThan(20);
      expect(doc.fires.length, event).toBeGreaterThan(20);
    }
  });

  it("quotes the tolerance from the signing code rather than restating it", () => {
    // A docs page claiming a different window than the code enforces is worse
    // than no docs: a customer would implement to the wrong number.
    expect(TIMESTAMP_TOLERANCE_SECONDS).toBe(TOLERANCE_SECONDS);
  });

  it("records that degraded is once per episode", () => {
    // The rule that keeps the noisiest event usable. If this wording ever goes
    // missing, somebody will build a pager on it.
    expect(EVENTS["domain.degraded"].fires).toContain("once per episode");
  });
});
