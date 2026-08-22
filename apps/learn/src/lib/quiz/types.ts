export interface Question {
  readonly correct: number;
  readonly explanation: string;
  readonly id: string;
  readonly options: readonly string[];
  readonly prompt: string;
  readonly source: string;
}

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
