"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useProgressContext } from "@/components/progress-provider";
import { CURRICULUM, unitIndex } from "@/lib/curriculum";
import { recordUnit } from "@/lib/progress";
import type { Question } from "@/lib/quiz/types";
import { useMastery } from "@/lib/use-mastery";
import { QuestionCard } from "./question-card";

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
