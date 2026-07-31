import type { DiagnosisCode, DiagnosisSeverity } from "../diagnosis/codes";
import type { QueryOutcome } from "../transport/types";

/**
 * The shape every evaluator returns.
 *
 * The load-bearing decision here is that a result carries its **derivation**,
 * not just a verdict. An evaluator that returns `permerror` is RFC-correct and
 * useless: the customer cannot act on it. What they need is which lookups
 * happened, what each returned, and which observation produced which finding.
 *
 * This is the same reasoning that keeps TXT chunks instead of the joined value.
 * A joined value cannot distinguish a clean split from a mangled one; a bare
 * verdict cannot tell someone what to change.
 */

/** One DNS lookup an evaluator made, and why. */
export interface Lookup {
  readonly name: string;
  readonly outcome: QueryOutcome;
  /**
   * Why this lookup happened, in the evaluator's own terms — "expected
   * selector", "probing for an appended zone name". This is what turns a list
   * of queries into an explanation.
   */
  readonly purpose: string;
  readonly type: number;
}

/**
 * What was seen, versus what was wanted.
 *
 * Optional throughout because findings differ: a missing record has a name but
 * no observed value, a mismatch has both. Rendering code decides what to show.
 */
export interface Evidence {
  /** One sentence of specifics, e.g. "1024-bit key, 2048 recommended". */
  readonly detail?: string;
  /** What the profile expected, when there is an expectation. */
  readonly expected?: string;
  /** The DNS name this finding is about. */
  readonly name?: string;
  /** What the zone actually contains, verbatim. */
  readonly observed?: string;
}

export interface Finding {
  readonly code: DiagnosisCode;
  readonly evidence: Evidence;
  readonly severity: DiagnosisSeverity;
}

/**
 * Whether the thing being checked is configured correctly.
 *
 * `indeterminate` is deliberately distinct from `fail`. A SERVFAIL or a timeout
 * means we could not tell, and reporting that as a failure is how a monitoring
 * product pages someone over a transient blip. Every evaluator must be able to
 * say "I do not know" — see the temperror/permerror distinction in SPF, which is
 * the same idea with an RFC behind it.
 */
export type Verdict = "pass" | "fail" | "warn" | "indeterminate";

export interface EvaluationResult {
  readonly findings: readonly Finding[];
  /** Every lookup made, in order. The derivation. */
  readonly lookups: readonly Lookup[];
  readonly verdict: Verdict;
}

/** Severity ranking, used to fold findings into a single verdict. */
const VERDICT_RANK: Readonly<Record<Verdict, number>> = {
  fail: 3,
  indeterminate: 2,
  pass: 0,
  warn: 1,
};

/**
 * The worst verdict wins, with one deliberate exception: `indeterminate`
 * outranks `warn` but loses to `fail`.
 *
 * "We could not tell" is more serious than a warning, because it means the
 * check did not run — but a definite failure we did observe is more actionable
 * than uncertainty about the rest.
 */
export function worstVerdict(verdicts: readonly Verdict[]): Verdict {
  let worst: Verdict = "pass";

  for (const verdict of verdicts) {
    if (VERDICT_RANK[verdict] > VERDICT_RANK[worst]) {
      worst = verdict;
    }
  }

  return worst;
}
