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

/**
 * Questions the repository already knows the answer to.
 *
 * `apps/docs` renders the taxonomy from `DIAGNOSIS_REGISTRY` and
 * `FIXTURE_EXPECTATIONS` rather than from hand-written pages, because
 * documentation written by hand drifts from the code it describes. A quiz is
 * documentation with a right answer, so it drifts the same way and worse: a
 * stale docs page misinforms, a stale quiz marks a correct answer wrong.
 *
 * So anything a registry can settle is generated from the registry, at build
 * time, and `derived.spec.ts` asserts each generated answer still resolves.
 * What is left for a person to write is the part no table holds — why
 * `indeterminate` neither increments nor resets a failure counter, and which
 * of two defensible designs the codebase picked.
 *
 * Each unit's `quiz.ts` calls these by name rather than receiving a bulk dump,
 * so the author decides which fixture is worth asking about in which unit.
 */

const DISTRACTOR_COUNT = 3;

const CODES = Object.keys(DIAGNOSIS_REGISTRY).toSorted();

/** Codes sharing a leading `SPF_`-style segment, which is the family. */
function familyOf(code: string): string {
  const [head] = code.split("_");

  return head ?? code;
}

/**
 * Distractors from the same family, so the question tests the fault rather
 * than the vocabulary.
 *
 * Asking whether `appended.test` produces `PROVIDER_APPENDED_ZONE_NAME` or
 * `SPF_VOID_LOOKUP` tests nothing: one of them is obviously about SPF. Drawn
 * from the same family the answer is in, the reader has to actually know which
 * fault the fixture carries. Falls back to the whole set when a family is too
 * small to fill the slots.
 */
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

/**
 * Which diagnosis code a fixture zone exists to produce.
 *
 * `code` is named explicitly rather than taken as the fixture's first, because
 * several fixtures carry more than one fault and which one a unit is teaching
 * is the unit's business. Throwing on a code the fixture does not list is the
 * whole point: it turns a question about the wrong fixture into a build
 * failure.
 */
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

/**
 * Whether a code is an error, a warning, or information.
 *
 * The distinction is not cosmetic: `applyHysteresis` treats a warning as a
 * passing check, so a code's severity decides whether it can eventually page
 * somebody. A reader who thinks `SPF_LOOKUP_LIMIT_NEAR` is an error has
 * misunderstood the state machine, not just the label.
 */
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

/**
 * Which requirement of an RFC is a stated gap rather than an implementation.
 *
 * The conformance ledger's most useful property is that it lists what is *not*
 * done, with a reason, and this is the question that makes a reader read that
 * column. Distractors are implemented requirements from the same RFC, so
 * guessing by topic does not work.
 */
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

  /**
   * Loudly, naming the shortfall.
   *
   * RFC 4035 is the case: one requirement in the ledger, and it is the gap, so
   * there is nothing implemented to distract with. A question with one option is
   * not a question, and the useful failure is this message rather than a guard
   * further downstream reporting "expected 1 to be at least 3" about a generated
   * id nobody can trace back.
   */
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

/**
 * Which code is exempt from the fixture requirement.
 *
 * The one question that reads the escape hatch rather than the rule. Distractors
 * are codes that *do* have a fixture, so answering it means knowing which fault
 * a zone file cannot express — and the explanation is the exemption's own
 * written reason, which is the thing worth reading.
 */
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
