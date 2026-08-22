"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useProgressContext } from "@/components/progress-provider";
import { CURRICULUM } from "@/lib/curriculum";
import { clearExam, examUnlocked, recordExam } from "@/lib/progress";
import type { Question } from "@/lib/quiz/types";
import { useMastery } from "@/lib/use-mastery";
import { QuestionCard } from "./question-card";

export function Exam({ questions }: { questions: readonly Question[] }) {
  const { progress, update } = useProgressContext();
  const mastery = useMastery(questions);
  const [retaking, setRetaking] = useState(false);

  const sitAgain = useCallback(() => {
    if (progress === null) {
      return;
    }

    update(clearExam(progress));
    mastery.reset();
    setRetaking(true);
  }, [mastery, progress, update]);

  useEffect(() => {
    if (progress === null || !mastery.done || questions.length === 0) {
      return;
    }

    if (progress.exam !== undefined) {
      return;
    }

    update(recordExam(progress, mastery.attempts, new Date().toISOString()));
  }, [mastery.attempts, mastery.done, progress, questions.length, update]);

  if (progress === null) {
    return <div className="h-64" />;
  }

  if (!examUnlocked(progress)) {
    const remaining = CURRICULUM.filter(
      (unit) => progress.units[unit.slug] === undefined
    );

    return (
      <section className="rise-in max-w-xl">
        <p className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-[0.2em]">
          Locked
        </p>
        <h1 className="mt-3 font-display text-4xl leading-[1.1] tracking-tight">
          The exam
        </h1>
        <p className="mt-4 text-muted-foreground leading-7">
          {remaining.length} of {CURRICULUM.length} units still have no outcome.
          The exam draws from all nine, so it opens when they all do.
        </p>
        <ul className="mt-6 flex flex-col gap-1">
          {remaining.map((unit) => (
            <li key={unit.slug}>
              <Link
                className="font-mono text-muted-foreground text-sm underline underline-offset-4 transition-colors hover:text-foreground"
                href={`/units/${unit.slug}`}
              >
                {unit.title}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const settled = progress.exam;

  if (settled !== undefined && (!retaking || mastery.done)) {
    return (
      <section className="rise-in max-w-xl">
        <p className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-[0.2em]">
          Done
        </p>
        <h1 className="mt-3 font-display text-4xl leading-[1.1] tracking-tight">
          That is the whole course
        </h1>
        <p className="mt-4 text-muted-foreground leading-7">
          Every question in the exam answered correctly, after{" "}
          {settled.attempts} wrong{" "}
          {settled.attempts === 1 ? "answer" : "answers"}.
        </p>
        <p className="mt-4 text-muted-foreground leading-7">
          What the course could not cover is the part nobody has measured yet.
          Several thresholds in the codebase ship commented as unmeasured, with
          the measurement that would justify them named alongside. Reading those
          comments is a reasonable next thing to do.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-8 border-border border-t pt-6">
          <a
            className="font-mono text-[0.6875rem] text-foreground uppercase tracking-widest underline underline-offset-4"
            href="https://docs.propgate.dev/conformance"
          >
            The RFC ledger
          </a>
          <a
            className="font-mono text-[0.6875rem] text-foreground uppercase tracking-widest underline underline-offset-4"
            href="https://docs.propgate.dev/taxonomy"
          >
            The taxonomy
          </a>
          <button
            className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-widest underline underline-offset-4 transition-colors hover:text-foreground"
            onClick={sitAgain}
            type="button"
          >
            Sit it again
          </button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <p className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-[0.2em]">
        The exam — {mastery.remaining} to answer, {mastery.attempts} wrong
      </p>
      <QuestionCard
        commitLabel={mastery.remaining === 1 ? "Finish" : "Next question"}
        mastery={mastery}
      />
    </section>
  );
}
