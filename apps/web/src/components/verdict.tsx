import type { Severity, Verdict } from "@/lib/check";
import { cn } from "@/lib/utils";

/**
 * How a verdict looks.
 *
 * A coloured spine down the left edge of a row rather than a pill: the page is
 * a readout of six parallel signals, and a trace reads faster down a column
 * than six badges do. The word is still written out, because colour alone is
 * not a label.
 */

const VERDICT_TONE: Readonly<Record<Verdict, string>> = {
  fail: "text-destructive",
  indeterminate: "text-unknown",
  pass: "text-success",
  warn: "text-warning",
};

const VERDICT_RAIL: Readonly<Record<Verdict, string>> = {
  fail: "bg-destructive",
  indeterminate: "bg-unknown",
  pass: "bg-success",
  warn: "bg-warning",
};

const VERDICT_WORD: Readonly<Record<Verdict, string>> = {
  fail: "failing",
  // Deliberately not "unknown": the domain is not unknown, our reading of it is.
  indeterminate: "couldn't tell",
  pass: "passing",
  warn: "worth a look",
};

const SEVERITY_TONE: Readonly<Record<Severity, string>> = {
  error: "bg-destructive",
  info: "bg-muted-foreground",
  warning: "bg-warning",
};

export function verdictTone(verdict: Verdict): string {
  return VERDICT_TONE[verdict];
}

export function verdictWord(verdict: Verdict): string {
  return VERDICT_WORD[verdict];
}

export function Rail({
  className,
  running,
  verdict,
}: {
  className?: string;
  running?: boolean;
  verdict: Verdict;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative w-px shrink-0 overflow-hidden rounded-full",
        running ? "bg-border" : VERDICT_RAIL[verdict],
        className
      )}
    >
      {running ? (
        <span className="absolute inset-x-0 h-1/4 animate-[sweep_1.4s_ease-in-out_infinite] bg-unknown" />
      ) : null}
    </span>
  );
}

export function SeverityDot({ severity }: { severity: Severity }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-[0.45rem] size-1.5 shrink-0 rounded-full",
        SEVERITY_TONE[severity]
      )}
    />
  );
}
