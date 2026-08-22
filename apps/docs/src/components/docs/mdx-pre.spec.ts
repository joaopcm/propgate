import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { MdxPre } from "./mdx-pre";

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

    expect(pre.props.className).toBe("p-4 shiki github-dark-dimmed");
  });
});
