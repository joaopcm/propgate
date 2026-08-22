import { QUESTIONS as UNIT_0 } from "@/content/00-the-last-twenty-percent/quiz";
import { QUESTIONS as UNIT_1 } from "@/content/01-dns-does-not-tell-the-truth/quiz";
import { QUESTIONS as UNIT_2 } from "@/content/02-a-resolver-with-no-dependencies/quiz";
import { QUESTIONS as UNIT_3 } from "@/content/03-spf-the-way-an-mta-reads-it/quiz";
import { QUESTIONS as UNIT_4 } from "@/content/04-keys-policies-and-trees/quiz";
import { QUESTIONS as UNIT_5 } from "@/content/05-asking-the-right-question/quiz";
import { QUESTIONS as UNIT_6 } from "@/content/06-believing-a-failure/quiz";
import { QUESTIONS as UNIT_7 } from "@/content/07-the-parts-that-cost-money/quiz";
import { QUESTIONS as UNIT_8 } from "@/content/08-publishing-a-contract/quiz";
import { CURRICULUM } from "@/lib/curriculum";
import type { Question } from "./types";

const BY_SLUG: Readonly<Record<string, readonly Question[]>> = {
  "a-resolver-with-no-dependencies": UNIT_2,
  "asking-the-right-question": UNIT_5,
  "believing-a-failure": UNIT_6,
  "dns-does-not-tell-the-truth": UNIT_1,
  "keys-policies-and-trees": UNIT_4,
  "publishing-a-contract": UNIT_8,
  "spf-the-way-an-mta-reads-it": UNIT_3,
  "the-last-twenty-percent": UNIT_0,
  "the-parts-that-cost-money": UNIT_7,
};

export function questionsFor(slug: string): readonly Question[] {
  return BY_SLUG[slug] ?? [];
}

export function allQuestions(): readonly Question[] {
  return CURRICULUM.flatMap((unit) => questionsFor(unit.slug));
}

export function coveredSlugs(): readonly string[] {
  return Object.keys(BY_SLUG);
}
