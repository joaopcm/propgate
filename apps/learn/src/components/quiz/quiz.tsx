"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useProgressContext } from "@/components/progress-provider";
import { CURRICULUM, unitIndex } from "@/lib/curriculum";
import { recordUnit } from "@/lib/progress";
import type { Question } from "@/lib/quiz/types";
import { useMastery } from "@/lib/use-mastery";
import { QuestionCard } from "./question-card";

/**
 * A unit's questions, and the only thing standing between the reader and the
 * next unit.
 *
 * There is no score, and inventing one would take a decision this course has
 * no evidence for. A passing mark is a number, and a number with no
 * measurement behind it is a landmine — 80% would let somebody through who got
 * the one question the unit was actually about wrong.
 *
 * So every question, correct, with unlimited retries. The consequence worth
 * naming is that this cannot be failed, only abandoned, which is the right
 * shape for a course nobody is grading and the reason the escape hatch on the
 * locked screen exists for a reader who wants out rather than through.
 */
export function Quiz({
  questions,
  slug,
}: {
  questions: readonly Question[];
  slug: string;
}) {
  const { progress, update } = useProgressContext();
  const mastery = useMastery(questions);
  const [retaking, setRetaking] = useState(false);
  const index = unitIndex(slug);
  const next = CURRICULUM[index + 1];

  const retake = useCallback(() => {
    mastery.reset();
    setRetaking(true);
  }, [mastery]);

  /**
   * Recording the pass is an effect rather than something `commit` does.
   *
   * `commit` is in `useMastery`, which knows nothing about units or storage,
   * and the alternative — a callback threaded through it — would put the
   * decision "what does finishing mean" in two places. Guarded on `done` and
   * on there being no record yet, so a re-render cannot write twice.
   */
  useEffect(() => {
    if (progress === null || !mastery.done || questions.length === 0) {
      return;
    }

    if (progress.units[slug]?.outcome === "passed") {
      return;
    }

    update(
      recordUnit(
        progress,
        slug,
        "passed",
        mastery.attempts,
        new Date().toISOString()
      )
    );
  }, [
    mastery.attempts,
    mastery.done,
    progress,
    questions.length,
    slug,
    update,
  ]);

  if (progress === null) {
    return <div className="mt-16 h-32" />;
  }

  const stored = progress.units[slug];
  const showOutcome = stored !== undefined && (!retaking || mastery.done);

  if (showOutcome) {
    return (
      <section className="mt-20 border-border border-t pt-8">
        <p className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-widest">
          {stored.outcome === "passed" ? "Unit passed" : "Unit skipped"}
        </p>
        <p className="mt-3 max-w-[38rem] text-muted-foreground leading-7">
          {stored.outcome === "passed"
            ? `Every question answered correctly, after ${stored.attempts} wrong ${stored.attempts === 1 ? "answer" : "answers"}.`
            : "This unit was opened without answering its questions. The rail keeps showing it that way, and the exam still draws from it."}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-8">
          {next === undefined ? (
            <Link
              className="font-mono text-[0.6875rem] text-foreground uppercase tracking-widest underline underline-offset-4"
              href="/exam"
            >
              Take the exam
            </Link>
          ) : (
            <Link
              className="font-mono text-[0.6875rem] text-foreground uppercase tracking-widest underline underline-offset-4"
              href={`/units/${next.slug}`}
            >
              Next — {next.title}
            </Link>
          )}
          <button
            className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-widest underline underline-offset-4 transition-colors hover:text-foreground"
            onClick={retake}
            type="button"
          >
            {stored.outcome === "passed" ? "Ask me again" : "Answer them now"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-20 border-border border-t pt-8">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-widest">
          {mastery.remaining} to answer
        </p>
        <p className="font-mono text-[0.6875rem] text-muted-foreground/60 uppercase tracking-widest">
          {mastery.attempts} wrong so far
        </p>
      </div>
      <QuestionCard
        commitLabel={
          mastery.remaining === 1 ? "Finish the unit" : "Next question"
        }
        mastery={mastery}
      />
    </section>
  );
}
