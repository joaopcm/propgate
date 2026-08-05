import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { MdxPre } from "./mdx-pre";

/**
 * `MdxPre` is a plain function that returns an element tree — no render
 * harness needed to see what it emits, and this app deliberately has none.
 *
 * `@shikijs/rehype` hands the `pre` its own `className` (`"shiki
 * github-dark-dimmed"`). `<pre className="p-4" {...props}>` let that spread
 * win over the literal class, so every fenced MDX block silently lost its
 * padding — nothing in `tsc`, Biome, or the existing specs could see it,
 * only the built HTML. Calling the component directly and reading the
 * returned element's props catches the same regression without a DOM.
 */

interface PreProps {
  readonly className?: string;
}

describe("MdxPre", () => {
  it("merges its own padding with an incoming className instead of losing one", () => {
    const wrapper = MdxPre({
      children: "curl https://example.com",
      className: "shiki github-dark-dimmed",
    });
    const pre = wrapper.props.children as ReactElement<PreProps>;

    // If the merge reverted to `className="p-4" {...props}`, the incoming
    // class would win outright and this would read "shiki github-dark-dimmed"
    // with no "p-4" — this exact string is what the bug looked like in the
    // built HTML.
    expect(pre.props.className).toBe("p-4 shiki github-dark-dimmed");
  });
});
