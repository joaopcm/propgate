"use client";

import { useCallback, useMemo, useState } from "react";
import type { Question } from "./quiz/types";

export interface Mastery {
  readonly answered: boolean;
  readonly attempts: number;
  readonly choose: (option: number) => void;
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
