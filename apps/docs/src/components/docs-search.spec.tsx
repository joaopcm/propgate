// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocsSearch } from "./docs-search";

/**
 * The keyboard, which nothing else in this repo can see.
 *
 * `search.spec.ts` covers ranking and `search-index.spec.ts` covers extraction,
 * and between them they were green while the `/` hotkey did not work at all —
 * it matched on `event.code` (`Slash`) against the hotkey string `/`, so the
 * binding never fired on any layout. Two defects in this component have now
 * reached review or production, and both were in the handful of lines no spec
 * touched. This is that spec.
 *
 * It asserts behaviour a reader would notice, not implementation: that the key
 * moves focus, that the same key inside the box types a slash instead, and that
 * Escape gives the page back.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Explicit, because Testing Library only registers its own afterEach when
// Vitest globals are enabled, and they are not here.
afterEach(cleanup);

/** A real keydown carries both, and telling them apart is the whole bug. */
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
