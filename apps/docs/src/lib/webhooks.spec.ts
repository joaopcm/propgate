import { TOLERANCE_SECONDS, WEBHOOK_EVENTS } from "@propgate/webhooks";
import { describe, expect, it } from "vitest";
import { EVENTS, TIMESTAMP_TOLERANCE_SECONDS } from "./webhooks";

describe("the event reference", () => {
  it("documents every event the product can send", () => {
    expect(Object.keys(EVENTS).toSorted()).toEqual(
      [...WEBHOOK_EVENTS].toSorted()
    );
  });

  it("says both what each event means and when it fires", () => {
    for (const [event, doc] of Object.entries(EVENTS)) {
      expect(doc.summary.length, event).toBeGreaterThan(20);
      expect(doc.fires.length, event).toBeGreaterThan(20);
    }
  });

  it("quotes the tolerance from the signing code rather than restating it", () => {
    expect(TIMESTAMP_TOLERANCE_SECONDS).toBe(TOLERANCE_SECONDS);
  });

  it("records that degraded is once per episode", () => {
    expect(EVENTS["domain.degraded"].fires).toContain("once per episode");
  });
});
