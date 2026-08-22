import { describe, expect, it } from "vitest";
import type { TransitionState } from "./payload";
import { eventForTransition, WEBHOOK_EVENTS, webhookPayload } from "./payload";

describe("eventForTransition", () => {
  it("tells a first success apart from a recovery", () => {
    expect(eventForTransition("pending", "verified")).toBe("domain.verified");
    expect(eventForTransition("degraded", "verified")).toBe("domain.recovered");
    expect(eventForTransition("failed", "verified")).toBe("domain.recovered");
  });

  it("maps the two unhealthy states to their own events", () => {
    expect(eventForTransition("verified", "degraded")).toBe("domain.degraded");
    expect(eventForTransition("degraded", "failed")).toBe("domain.failed");
  });

  it("says nothing about internal states", () => {
    expect(eventForTransition("verified", "pending")).toBeNull();
    expect(eventForTransition("pending", "verifying")).toBeNull();
  });

  it("only ever produces a published event name", () => {
    const states: TransitionState[] = [
      "degraded",
      "failed",
      "pending",
      "verified",
      "verifying",
    ];

    for (const from of states) {
      for (const to of states) {
        const event = eventForTransition(from, to);

        if (event !== null) {
          expect(WEBHOOK_EVENTS).toContain(event);
        }
      }
    }
  });
});

describe("webhookPayload", () => {
  it("is snake_case on the wire", () => {
    const payload = webhookPayload({
      createdAt: new Date("2026-08-03T12:00:00.000Z"),
      domain: "example.com",
      domainId: "dom_1",
      event: "domain.recovered",
      externalId: "cust_1",
      from: "failed",
      reason: "recovered from failed after a passing check",
      to: "verified",
    });

    expect(Object.keys(payload).sort()).toEqual(["created_at", "data", "type"]);
    expect(Object.keys(payload.data).sort()).toEqual([
      "domain",
      "external_id",
      "id",
      "previous_state",
      "reason",
      "state",
    ]);
  });

  it("carries where the domain came from, not just where it is", () => {
    const payload = webhookPayload({
      createdAt: new Date("2026-08-03T12:00:00.000Z"),
      domain: "example.com",
      domainId: "dom_1",
      event: "domain.recovered",
      externalId: null,
      from: "failed",
      reason: "recovered",
      to: "verified",
    });

    expect(payload.data.previous_state).toBe("failed");
    expect(payload.data.state).toBe("verified");
    expect(payload.data.external_id).toBeNull();
  });
});
