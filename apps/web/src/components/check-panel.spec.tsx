import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CHECK_LABELS, type CheckOutcome } from "@/lib/check";
import { CheckPanel } from "./check-panel";

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
    render(<CheckPanel index={0} outcome={outcome({ verdict: "fail" })} />);

    expect(
      screen.getByRole("heading", { name: CHECK_LABELS.spf })
    ).toBeDefined();
    expect(screen.getByText(FAILING)).toBeDefined();
  });

  it("does not call an indeterminate check unknown", () => {
    render(
      <CheckPanel index={0} outcome={outcome({ verdict: "indeterminate" })} />
    );

    expect(screen.queryByText(UNKNOWN)).toBeNull();
    expect(screen.getByText(COULD_NOT_TELL)).toBeDefined();
  });

  it("shows what was observed against what was expected", () => {
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
