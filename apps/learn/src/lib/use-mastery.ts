"use client";

import { useCallback, useMemo, useState } from "react";
import type { Question } from "./quiz/types";

/**
 * The loop both the unit quizzes and the exam run.
 *
 * Extracted because they are the same machine, not because two call sites are
 * two too many. A unit quiz and an exam that drifted into slightly different
 * rules — one requeueing wrong answers, one advancing past them — would be a
 * course where passing meant two things.
 *
 * The rule: a queue of question ids, correct answers leave it, wrong answers go
 * to the back. `done` is the queue being empty, and there is no score to
 * compare against a threshold.
 */

export interface Mastery {
  /** True once an option is picked and the explanation is showing. */
  readonly answered: boolean;
  /** Wrong answers so far. Reported, never scored. */
  readonly attempts: number;
  readonly choose: (option: number) => void;
  /** Null until the reader picks. */
  readonly chosen: number | null;
  readonly commit: () => void;
  readonly correct: boolean;
  readonly current: Question | undefined;
  readonly done: boolean;
  readonly remaining: number;
  readonly reset: () => void;
}

export function useMastery(questions: readonly Question[]): Mastery {
  const byId = useMemo(
    () => new Map(questions.map((question) => [question.id, question])),
    [questions]
  );
  const [queue, setQueue] = useState<readonly string[]>(() =>
    questions.map((question) => question.id)
  );
  const [chosen, setChosen] = useState<number | null>(null);
  const [attempts, setAttempts] = useState(0);

  const [currentId] = queue;
  const current = currentId === undefined ? undefined : byId.get(currentId);
  const correct = chosen !== null && chosen === current?.correct;

  const choose = useCallback(
    (option: number) => {
      if (chosen !== null || current === undefined) {
        return;
      }

      setChosen(option);

      if (option !== current.correct) {
        setAttempts((count) => count + 1);
      }
    },
    [chosen, current]
  );

  /**
   * Move on. A correct answer leaves the queue; a wrong one goes to the back
   * rather than being asked again immediately — the reader has just read the
   * explanation, and re-asking in the same breath tests whether they can hold
   * one sentence in mind, not whether they understood it.
   */
  const commit = useCallback(() => {
    setChosen(null);
    setQueue((previous) => {
      const [head, ...rest] = previous;

      if (head === undefined) {
        return previous;
      }

      return correct ? rest : [...rest, head];
    });
  }, [correct]);

  const reset = useCallback(() => {
    setQueue(questions.map((question) => question.id));
    setChosen(null);
    setAttempts(0);
  }, [questions]);

  return {
    answered: chosen !== null,
    attempts,
    choose,
    chosen,
    commit,
    correct,
    current,
    done: queue.length === 0,
    remaining: queue.length,
    reset,
  };
}
