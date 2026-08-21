import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CONTACT_BODY } from "@/lib/site";
import { Prose } from "./site-frame";

afterEach(cleanup);

describe("Prose", () => {
  it("renders the contact resources as a stacked list, not one paragraph", () => {
    render(<Prose text={CONTACT_BODY} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(7);
    expect(items[0]?.textContent?.includes("API reference")).toBe(true);
    expect(items.at(-1)?.textContent?.includes("Agent index")).toBe(true);
    expect(
      screen.queryByText("API reference:", { exact: false })?.closest("p")
    ).toBeNull();
  });
});
