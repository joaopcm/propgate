import {
  DIAGNOSIS_REGISTRY,
  NOT_LOCALLY_REPRODUCIBLE,
  summary,
} from "@propgate/dns";
import {
  coveredDiagnosisCodes,
  FIXTURE_EXPECTATIONS,
} from "@propgate/dns-fixtures";
import type { Question } from "./types";
import { withOptions } from "./types";

const DISTRACTOR_COUNT = 3;

const CODES = Object.keys(DIAGNOSIS_REGISTRY).toSorted();

function familyOf(code: string): string {
  const [head] = code.split("_");

  return head ?? code;
}

function distractorsFor(
  answer: string,
  excluded: readonly string[]
): readonly string[] {
  const family = familyOf(answer);
  const forbidden = new Set(excluded);
  const sameFamily = CODES.filter(
    (code) => familyOf(code) === family && !forbidden.has(code)
  );
  const rest = CODES.filter(
    (code) => familyOf(code) !== family && !forbidden.has(code)
  );

  return [...sameFamily, ...rest].slice(0, DISTRACTOR_COUNT);
}

function fixtureFor(zone: string) {
  const fixture = FIXTURE_EXPECTATIONS.find((entry) => entry.zone === zone);

  if (fixture === undefined) {
    throw new Error(
      `no fixture for zone "${zone}" — see packages/dns-fixtures/src/expectations.ts`
    );
  }

  return fixture;
}

export function fixtureCodeQuestion(zone: string, code: string): Question {
  const fixture = fixtureFor(zone);

  if (!fixture.codes.includes(code)) {
    throw new Error(
      `${zone} is not expected to produce ${code} — its codes are ${fixture.codes.join(", ")}`
    );
  }

  return withOptions(
    {
      explanation: fixture.reason,
      id: `fixture:${zone}:${code}`,
      prompt: `The fixture zone \`${zone}\` exists to produce one particular diagnosis. Which is it?`,
      source: "packages/dns-fixtures/src/expectations.ts",
    },
    code,
    distractorsFor(code, fixture.codes)
  );
}

export function severityQuestion(code: string): Question {
  const definition =
    DIAGNOSIS_REGISTRY[code as keyof typeof DIAGNOSIS_REGISTRY];

  if (definition === undefined) {
    throw new Error(`no diagnosis code "${code}"`);
  }

  return withOptions(
    {
      explanation: definition.summary,
      id: `severity:${code}`,
      prompt: `\`${code}\` — what severity does the taxonomy give it?`,
      source: "packages/dns/src/diagnosis/codes.ts",
    },
    definition.severity,
    ["error", "warning", "info"].filter(
      (value) => value !== definition.severity
    )
  );
}

export function requirementGapQuestion(rfc: number): Question {
  const coverage = summary().rfcs.find((entry) => entry.rfc === rfc);

  if (coverage === undefined) {
    throw new Error(`RFC ${rfc} is not in the conformance ledger`);
  }

  const [gap] = coverage.gaps;

  if (gap === undefined) {
    throw new Error(
      `RFC ${rfc} has no gaps in the ledger, so there is nothing to ask`
    );
  }

  const implemented = coverage.requirements
    .filter((entry) => entry.status === "implemented")
    .map((entry) => entry.requirement)
    .toSorted()
    .slice(0, DISTRACTOR_COUNT);

  if (implemented.length < DISTRACTOR_COUNT) {
    throw new Error(
      `RFC ${rfc} has ${implemented.length} implemented requirement(s) to distract with, and a question needs ${DISTRACTOR_COUNT}`
    );
  }

  return withOptions(
    {
      explanation:
        gap.note ??
        `Recorded as a gap in the ledger at RFC ${rfc} §${gap.section}.`,
      id: `gap:${rfc}:${gap.section}`,
      prompt: `One of these is a stated gap in what \`@propgate/dns\` implements of RFC ${rfc}. Which?`,
      source: "packages/dns/src/conformance/requirements.ts",
    },
    gap.requirement,
    implemented
  );
}

export function unreproducibleCodeQuestion(code: string): Question {
  const reason =
    NOT_LOCALLY_REPRODUCIBLE[code as keyof typeof NOT_LOCALLY_REPRODUCIBLE];

  if (reason === undefined) {
    throw new Error(`${code} is not recorded as unreproducible`);
  }

  const covered = coveredDiagnosisCodes();
  const distractors = CODES.filter((candidate) => covered.has(candidate)).slice(
    0,
    DISTRACTOR_COUNT
  );

  return withOptions(
    {
      explanation: reason,
      id: `unreproducible:${code}`,
      prompt:
        "One of these codes has no fixture behind it, and carries a written reason why no local fixture could produce it. Which?",
      source: "packages/dns/src/diagnosis/codes.ts",
    },
    code,
    distractors
  );
}
