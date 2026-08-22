// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocsSearch } from "./docs-search";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(cleanup);

function slash(): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code: "Slash",
    key: "/",
  });
}

describe("the / hotkey", () => {
  it("focuses the box from anywhere on the page", () => {
    render(<DocsSearch />);
    const input = screen.getByRole("combobox");

    expect(document.activeElement).not.toBe(input);

    document.dispatchEvent(slash());

    expect(document.activeElement).toBe(input);
  });

  it("swallows the keystroke so the slash is not also typed", () => {
    render(<DocsSearch />);
    const event = slash();

    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves a slash typed inside the box alone", () => {
    render(<DocsSearch />);
    const input = screen.getByRole("combobox");
    input.focus();

    const event = slash();
    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("gives the page back on Escape", () => {
    render(<DocsSearch />);
    const input = screen.getByRole("combobox");

    document.dispatchEvent(slash());
    expect(document.activeElement).toBe(input);

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "Escape",
        key: "Escape",
      })
    );

    expect(document.activeElement).not.toBe(input);
  });
});
