import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

/**
 * Cases taken from headings that actually exist in this corpus.
 *
 * A slugifier is trivial until it meets a heading with a backticked identifier
 * or a package name in it, and both are ordinary here.
 */

describe("slugify", () => {
  it("lowercases and hyphenates ordinary prose", () => {
    expect(slugify("The sweeper")).toBe("the-sweeper");
  });

  it("keeps the words of a snake_case identifier apart", () => {
    expect(slugify("The SWEEP_TICK_SECONDS loop")).toBe(
      "the-sweep-tick-seconds-loop"
    );
  });

  it("collapses punctuation rather than leaving it in the url", () => {
    expect(slugify("Hysteresis: how many failures it takes")).toBe(
      "hysteresis-how-many-failures-it-takes"
    );
  });

  it("handles a scoped package name", () => {
    expect(slugify("@propgate/dns")).toBe("propgate-dns");
  });

  it("never leads or trails with a hyphen", () => {
    expect(slugify("— Consensus across vantage points —")).toBe(
      "consensus-across-vantage-points"
    );
  });

  it("is empty for text with nothing sluggable in it", () => {
    expect(slugify("———")).toBe("");
  });
});
