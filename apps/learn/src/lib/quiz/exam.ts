import { CURRICULUM } from "@/lib/curriculum";
import { questionsFor } from "./all";
import type { Question } from "./types";

const PER_UNIT = 2;

function sample(questions: readonly Question[], count: number): Question[] {
  if (questions.length <= count) {
    return [...questions];
  }

  const stride = questions.length / count;

  return Array.from({ length: count }, (_, index) => {
    const question = questions[Math.floor(index * stride)];

    if (question === undefined) {
      throw new Error("stride walked off the end of the question list");
    }

    return question;
  });
}

export function examQuestions(): readonly Question[] {
  return CURRICULUM.flatMap((unit) =>
    sample(questionsFor(unit.slug), PER_UNIT)
  );
}
