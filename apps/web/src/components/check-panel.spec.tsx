import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CHECK_LABELS, type CheckOutcome } from "@/lib/check";
import { CheckPanel } from "./check-panel";

/**
 * What a stranger actually sees.
 *
 * `check.spec.ts` covers the lib — parsing, ordering, summarising — and nothing
 * asserted that any of it reaches the screen. This is the top of the funnel: the
 * page a first visitor forms an opinion from, and the one surface where a
 * regression is invisible to every other spec in the repo.
 *
 * These assert the things that make the readout worth reading rather than the
 * markup around them. Class names and layout are free to change; the evidence
 * being visible is not.
 */

// Explicit, because Testing Library only registers its own afterEach when
// Vitest globals are enabled, and they are not here. Without this the DOM
// accumulates across tests and the failure arrives several specs later as
// "found multiple elements" — which is where it cost me twenty minutes.
afterEach(cleanup);

const FAILING = /failing/i;
const UNKNOWN = /^unknown$/i;
const COULD_NOT_TELL = /couldn't tell/i;
const OBSERVED = /observed/i;
const LOOKUP_LIMIT = /close to the ten-lookup limit/;
const SEVEN_LOOKUPS = /at most 7 lookups/;
const DKIM_MISSING = /DKIM_RECORD_MISSING/i;

function outcome(overrides: Partial<CheckOutcome> = {}): CheckOutcome {
  return {
    findings: [],
    kind: "spf",
    lookups: [],
    verdict: "pass",
    ...overrides,
  };
}

describe("CheckPanel", () => {
  it("names the check and its verdict in words, not only colour", () => {
    // Colour alone is not a label, and roughly one man in twelve cannot read
    // this one.
    render(<CheckPanel index={0} outcome={outcome({ verdict: "fail" })} />);

    // By heading role and via the label map: the wording is free to change and
    // the label appears more than once on the row, but the check being named as
    // the heading is the part that matters.
    expect(
      screen.getByRole("heading", { name: CHECK_LABELS.spf })
    ).toBeDefined();
    expect(screen.getByText(FAILING)).toBeDefined();
  });

  it("does not call an indeterminate check unknown", () => {
    // The domain is not unknown. Our reading of it is, and the wording carries
    // the distinction the whole four-verdict design exists for.
    render(
      <CheckPanel index={0} outcome={outcome({ verdict: "indeterminate" })} />
    );

    expect(screen.queryByText(UNKNOWN)).toBeNull();
    expect(screen.getByText(COULD_NOT_TELL)).toBeDefined();
  });

  it("shows what was observed against what was expected", () => {
    // The reasoning is the product. A summary with the evidence hidden is the
    // same readout every other checker already gives.
    render(
      <CheckPanel
        index={0}
        outcome={outcome({
          findings: [
            {
              code: "SPF_LOOKUP_LIMIT_NEAR",
              evidence: {
                expected: "at most 7 lookups, to leave room to grow",
                name: "github.com",
                observed: "10 lookups",
              },
              severity: "warning",
              slug: "spf-lookup-limit-near",
              summary:
                "This domain's SPF record is close to the ten-lookup limit.",
            },
          ],
          verdict: "warn",
        })}
      />
    );

    expect(screen.getByText(LOOKUP_LIMIT)).toBeDefined();
    expect(screen.getByText("10 lookups")).toBeDefined();
    expect(screen.getByText(SEVEN_LOOKUPS)).toBeDefined();
  });

  it("links a finding to the code that documents it", () => {
    // A code with nowhere to read about it is a string. The link is what makes
    // the taxonomy usable by whoever hit the problem.
    render(
      <CheckPanel
        index={0}
        outcome={outcome({
          findings: [
            {
              code: "DKIM_RECORD_MISSING",
              evidence: { name: "pg1._domainkey.example.com" },
              severity: "error",
              slug: "dkim-record-missing",
              summary: "No DKIM record was found at the selector.",
            },
          ],
          verdict: "fail",
        })}
      />
    );

    const link = screen.getByRole("link", { name: DKIM_MISSING });

    expect(link.getAttribute("href")).toContain("dkim-record-missing");
  });

  it("says nothing rather than inventing reassurance when a check is clean", () => {
    render(<CheckPanel index={0} outcome={outcome()} />);

    expect(
      screen.getByRole("heading", { name: CHECK_LABELS.spf })
    ).toBeDefined();
    expect(screen.queryByText(OBSERVED)).toBeNull();
  });
});
