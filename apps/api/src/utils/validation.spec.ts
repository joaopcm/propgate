import { describe, expect, it } from "vitest";
import { z } from "zod";
import { firstIssue } from "./validation";

const schema = z.object({
  domain: z.string(),
  requirements: z.array(z.object({ check: z.string() })).optional(),
});

function messageFor(body: unknown): string {
  const parsed = schema.safeParse(body);

  if (parsed.success) {
    throw new Error("expected the body to fail validation");
  }

  return firstIssue(parsed.error);
}

describe("firstIssue", () => {
  it("names the field, which is the part Zod leaves out", () => {
    // "Invalid input: expected string, received undefined" is true of a great
    // many bodies and tells an integrator nothing about which one they sent.
    expect(messageFor({})).toBe(
      "domain: Invalid input: expected string, received undefined"
    );
  });

  it("renders array indices as a path a reader can find in their JSON", () => {
    expect(messageFor({ domain: "a.example", requirements: [{}] })).toBe(
      "requirements[0].check: Invalid input: expected string, received undefined"
    );
  });

  it("adds no prefix when the fault is the whole body", () => {
    // There is no field to name: the issue path is empty. Zod's own message
    // contains a colon of its own, so the assertion is about the absence of a
    // path prefix rather than the absence of punctuation.
    expect(messageFor("not an object at all")).toBe(
      "Invalid input: expected object, received string"
    );
  });

  it("reports one issue, not a list", () => {
    // A caller fixes one thing and asks again. Eight complaints about a body
    // they got fundamentally wrong is noise rather than help.
    const message = messageFor({ requirements: [{}] });

    expect(message.split("\n")).toHaveLength(1);
    expect(message.startsWith("domain:")).toBe(true);
  });
});
