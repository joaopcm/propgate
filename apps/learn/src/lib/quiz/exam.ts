import { CURRICULUM } from "@/lib/curriculum";
import { questionsFor } from "./all";
import type { Question } from "./types";

/**
 * The final exam: a fixed number of questions from every unit.
 *
 * Deterministic rather than randomised, and the reason is the same one behind
 * sorting a question's options. This is a static export built once; a random
 * sample would mean the exam differed between the HTML two readers were served
 * and between two builds of the same content, for no gain a reader can name.
 *
 * Even per unit rather than proportional. A unit with fourteen questions is not
 * more important than one with six — it is a unit about DNS pathologies, which
 * are simply more numerous than the ideas in the systems half.
 */

const PER_UNIT = 2;

/**
 * Spread across a unit's questions rather than taking the first two.
 *
 * Questions are written in the order the prose introduces them, so the first
 * two of every unit would make the exam a test of each unit's opening
 * paragraphs. Stepping through at an even stride reaches the later material,
 * which is usually the part that was hard.
 */
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
