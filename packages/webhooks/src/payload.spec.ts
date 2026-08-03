import { describe, expect, it } from "vitest";
import type { TransitionState } from "./payload";
import { eventForTransition, WEBHOOK_EVENTS, webhookPayload } from "./payload";

/**
 * Which state change means which event.
 *
 * The mapping is small and entirely made of decisions, so it is worth pinning
 * every one of them.
 */

describe("eventForTransition", () => {
  it("tells a first success apart from a recovery", () => {
    // The case worth having a spec for. A handler that sends "you're all set"
    // should do it once; one that sends "we're back" should do it every time. If
    // these collapsed into one event a customer would email their user a welcome
    // note every time DNS flapped.
    expect(eventForTransition("pending", "verified")).toBe("domain.verified");
    expect(eventForTransition("degraded", "verified")).toBe("domain.recovered");
    expect(eventForTransition("failed", "verified")).toBe("domain.recovered");
  });

  it("maps the two unhealthy states to their own events", () => {
    expect(eventForTransition("verified", "degraded")).toBe("domain.degraded");
    expect(eventForTransition("degraded", "failed")).toBe("domain.failed");
  });

  it("says nothing about internal states", () => {
    // A customer does not need to hear that we are about to look at something.
    expect(eventForTransition("verified", "pending")).toBeNull();
    expect(eventForTransition("pending", "verifying")).toBeNull();
  });

  it("only ever produces a published event name", () => {
    // A typo here would be an event nobody has subscribed to, delivered forever
    // and silently ignored.
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
    // Inconsistent with every internal type here, and deliberately so: this shape
    // is a contract with other people's code and has to match the docs.
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
    // A handler that only sees `state: verified` cannot tell a new customer from
    // one whose outage just ended.
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
    // Null rather than omitted: a customer destructuring this should get null
    // rather than undefined for a domain they never gave an id.
    expect(payload.data.external_id).toBeNull();
  });
});
