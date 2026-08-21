import { DIAGNOSIS_REGISTRY, summary } from "@propgate/dns";
import { FIXTURE_EXPECTATIONS } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { allQuestions } from "./all";
import {
  fixtureCodeQuestion,
  requirementGapQuestion,
  severityQuestion,
} from "./derived";

/**
 * The generated questions, checked against the registries that generated them.
 *
 * Most of this is redundant while the generators are correct, which is the
 * point: the assertions that matter are the last two, which walk every
 * question actually reaching a reader and confirm its answer still exists.
 * A diagnosis code renamed in `@propgate/dns` is a breaking change by
 * invariant 7 — this is the line in the course that notices.
 */

const CODES = new Set(Object.keys(DIAGNOSIS_REGISTRY));
const NO_FIXTURE = /no fixture/;
const NOT_EXPECTED = /not expected to produce/;
const NO_SUCH_CODE = /no diagnosis code/;
const NOT_IN_LEDGER = /not in the conformance/;

describe("a fixture question", () => {
  it("asks about a code the fixture is expected to produce", () => {
    const question = fixtureCodeQuestion(
      "appended.test",
      "PROVIDER_APPENDED_ZONE_NAME"
    );

    expect(question.options[question.correct]).toBe(
      "PROVIDER_APPENDED_ZONE_NAME"
    );
  });

  it("carries the fixture's own reason as the explanation", () => {
    const fixture = FIXTURE_EXPECTATIONS.find(
      (entry) => entry.zone === "appended.test"
    );
    const question = fixtureCodeQuestion(
      "appended.test",
      "PROVIDER_APPENDED_ZONE_NAME"
    );

    expect(question.explanation).toBe(fixture?.reason);
  });

  it("never offers another code the same fixture also produces", () => {
    for (const fixture of FIXTURE_EXPECTATIONS) {
      for (const code of fixture.codes) {
        if (!CODES.has(code)) {
          continue;
        }

        const question = fixtureCodeQuestion(fixture.zone, code);
        const wrong = question.options.filter((option) => option !== code);

        for (const option of wrong) {
          expect(
            fixture.codes.includes(option),
            `${fixture.zone} offers ${option}, which it also produces`
          ).toBe(false);
        }
      }
    }
  });

  it("refuses a zone with no fixture", () => {
    expect(() => fixtureCodeQuestion("nope.test", "MX_NULL")).toThrow(
      NO_FIXTURE
    );
  });

  it("refuses a code the fixture does not produce", () => {
    expect(() => fixtureCodeQuestion("appended.test", "MX_NULL")).toThrow(
      NOT_EXPECTED
    );
  });
});

describe("a severity question", () => {
  it("answers with the registry's severity", () => {
    const question = severityQuestion("SPF_LOOKUP_LIMIT_NEAR");

    expect(question.options[question.correct]).toBe(
      DIAGNOSIS_REGISTRY.SPF_LOOKUP_LIMIT_NEAR.severity
    );
  });

  it("offers all three severities and nothing else", () => {
    const question = severityQuestion("SPF_LOOKUP_LIMIT_NEAR");

    expect(question.options.toSorted()).toEqual(["error", "info", "warning"]);
  });

  it("refuses a code that does not exist", () => {
    expect(() => severityQuestion("NOT_A_CODE")).toThrow(NO_SUCH_CODE);
  });
});

describe("a conformance gap question", () => {
  it("answers with a requirement the ledger records as not implemented", () => {
    const question = requirementGapQuestion(7208);
    const answer = question.options[question.correct];
    const gaps = summary()
      .rfcs.find((entry) => entry.rfc === 7208)
      ?.gaps.map((gap) => gap.requirement);

    expect(gaps).toContain(answer);
  });

  it("distracts only with requirements that are implemented", () => {
    const question = requirementGapQuestion(7208);
    const answer = question.options[question.correct];
    const coverage = summary().rfcs.find((entry) => entry.rfc === 7208);
    const implemented = new Set(
      coverage?.requirements
        .filter((entry) => entry.status === "implemented")
        .map((entry) => entry.requirement)
    );

    for (const option of question.options) {
      if (option === answer) {
        continue;
      }

      expect(implemented.has(option), option).toBe(true);
    }
  });

  it("refuses an RFC the ledger does not cover", () => {
    expect(() => requirementGapQuestion(1)).toThrow(NOT_IN_LEDGER);
  });
});

describe("every question that reaches a reader", () => {
  /**
   * The assertion this file exists for. A generated question's answer is a
   * string copied out of a registry at build time; if the registry has since
   * dropped it, the quiz marks a correct answer wrong and nothing else notices.
   */
  it("names a diagnosis code that still exists, where it names one at all", () => {
    for (const question of allQuestions()) {
      if (!question.id.startsWith("fixture:")) {
        continue;
      }

      for (const option of question.options) {
        expect(CODES.has(option), `${question.id} offers ${option}`).toBe(true);
      }
    }
  });

  it("names a fixture zone that still exists, where it names one at all", () => {
    const zones = new Set(FIXTURE_EXPECTATIONS.map((entry) => entry.zone));

    for (const question of allQuestions()) {
      if (!question.id.startsWith("fixture:")) {
        continue;
      }

      const [, zone] = question.id.split(":");

      expect(zones.has(zone ?? ""), question.id).toBe(true);
    }
  });
});
