/**
 * One question, and the shape is the same whether a person wrote it or a
 * registry produced it.
 *
 * No difficulty, no weight, no points. A quiz here is not scored — every
 * question has to be answered correctly before the unit is passed — so a field
 * ranking them would exist only to be ignored.
 */
export interface Question {
  /**
   * Which option is right, as an index into `options`.
   *
   * An index rather than the string, so a typo in the answer is a mismatch the
   * guard catches instead of a question with no correct option at runtime.
   */
  readonly correct: number;
  /**
   * Why, shown after a wrong answer and never before.
   *
   * Required. A wrong answer with no explanation is a dead end, and the whole
   * mastery loop depends on the reader learning something from the miss before
   * the question comes round again.
   */
  readonly explanation: string;
  /** Stable across builds. The queue and the exam both key on it. */
  readonly id: string;
  readonly options: readonly string[];
  readonly prompt: string;
  /**
   * The file in this repository that settles it, relative to the repo root.
   *
   * Load-bearing rather than decorative: a reader who disagrees with an
   * explanation should be able to go and read the code, and
   * `authored.spec.ts` asserts the path exists so the citation cannot rot.
   */
  readonly source: string;
}

/**
 * Sort options and point `correct` at the right one.
 *
 * Every question is built from a correct answer plus distractors, and something
 * has to decide the order. Alphabetical rather than shuffled, because a static
 * export is built once and a random order would change the HTML on every
 * build for no reader-visible benefit — and because "the answer is always
 * first" is the failure mode a naive concatenation produces.
 */
export function withOptions(
  question: Omit<Question, "correct" | "options">,
  answer: string,
  distractors: readonly string[]
): Question {
  const options = [answer, ...distractors].toSorted((a, b) =>
    a.localeCompare(b)
  );

  return { ...question, correct: options.indexOf(answer), options };
}
