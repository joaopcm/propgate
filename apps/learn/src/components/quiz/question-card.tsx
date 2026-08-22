"use client";

import { useCallback } from "react";
import { cn } from "@/lib/cn";
import type { Mastery } from "@/lib/use-mastery";

type OptionState = "chosen" | "correct" | "idle" | "wrong";

function shellFor(state: OptionState): string {
  switch (state) {
    case "correct":
      return "border-[var(--color-success)] text-foreground";
    case "wrong":
      return "border-[var(--color-destructive)] text-foreground";
    case "chosen":
      return "border-mark text-foreground";
    default:
      return "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground";
  }
}

function Option({
  disabled,
  label,
  onChoose,
  position,
  state,
}: {
  disabled: boolean;
  label: string;
  onChoose: (position: number) => void;
  position: number;
  state: OptionState;
}) {
  const choose = useCallback(() => onChoose(position), [onChoose, position]);

  return (
    <li>
      <button
        className={cn(
          "w-full border px-4 py-3 text-left font-mono text-[0.8125rem] leading-6 transition-colors",
          shellFor(state),
          disabled && "cursor-default"
        )}
        disabled={disabled}
        onClick={choose}
        type="button"
      >
        {label}
      </button>
    </li>
  );
}

function stateFor(
  answered: boolean,
  chosen: number | null,
  correctIndex: number,
  position: number
): OptionState {
  if (answered && position === correctIndex) {
    return "correct";
  }

  if (answered && chosen === position) {
    return "wrong";
  }

  return chosen === position ? "chosen" : "idle";
}

export function QuestionCard({
  commitLabel,
  mastery,
}: {
  commitLabel: string;
  mastery: Mastery;
}) {
  const { answered, chosen, choose, commit, correct, current } = mastery;

  if (current === undefined) {
    return null;
  }

  return (
    <>
      <p className="mt-4 max-w-[34rem] font-display text-2xl leading-snug sm:text-3xl">
        {current.prompt}
      </p>

      <ul className="mt-6 flex max-w-[38rem] flex-col gap-2">
        {current.options.map((option, position) => (
          <Option
            disabled={answered}
            key={option}
            label={option}
            onChoose={choose}
            position={position}
            state={stateFor(answered, chosen, current.correct, position)}
          />
        ))}
      </ul>

      {answered ? (
        <div className="mt-6 max-w-[38rem] border-rule border-l-2 pl-4">
          <p
            className={cn(
              "font-mono text-[0.6875rem] uppercase tracking-widest",
              correct
                ? "text-[var(--color-success)]"
                : "text-[var(--color-destructive)]"
            )}
          >
            {correct ? "Correct" : "Not that one"}
          </p>
          <p className="mt-2 text-muted-foreground text-sm leading-7">
            {current.explanation}
          </p>
          <p className="mt-2 font-mono text-muted-foreground/60 text-xs">
            {current.source}
          </p>
          <button
            className="mt-4 font-mono text-[0.6875rem] text-foreground uppercase tracking-widest underline underline-offset-4"
            onClick={commit}
            type="button"
          >
            {correct ? commitLabel : "Come back to it"}
          </button>
        </div>
      ) : null}
    </>
  );
}
