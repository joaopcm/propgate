import { describe, expect, it } from "vitest";
import { blocksFrom } from "./prose";
import { CONTACT_BODY } from "./site";

describe("blocksFrom", () => {
  it("keeps ordinary paragraphs as paragraphs", () => {
    expect(blocksFrom("One.\n\nTwo.")).toEqual([
      { kind: "p", text: "One." },
      { kind: "p", text: "Two." },
    ]);
  });

  it("turns a dash list into a ul, not one paragraph", () => {
    expect(blocksFrom("- API\n- CLI\n- SDK")).toEqual([
      { items: ["API", "CLI", "SDK"], kind: "ul" },
    ]);
  });

  it("splits a heading line from the list that follows it", () => {
    expect(blocksFrom("Resources:\n- API\n- CLI")).toEqual([
      { kind: "p", text: "Resources:" },
      { items: ["API", "CLI"], kind: "ul" },
    ]);
  });

  it("keeps the contact page's developer resources as seven list items", () => {
    const lists = blocksFrom(CONTACT_BODY).filter(
      (block) => block.kind === "ul"
    );

    expect(lists).toHaveLength(1);
    expect(lists[0]?.kind === "ul" && lists[0].items).toEqual([
      expect.stringContaining("API reference"),
      expect.stringContaining("Authentication"),
      expect.stringContaining("OpenAPI spec"),
      expect.stringContaining("CLI"),
      expect.stringContaining("Node SDK"),
      expect.stringContaining("Webhooks"),
      expect.stringContaining("Agent index"),
    ]);
  });
});
