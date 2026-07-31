import type { DiagnosisCode, DiagnosisSeverity } from "../diagnosis/codes";
import type { QueryOutcome } from "../transport/types";
import type { ServerAddress } from "../types";

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
  /**
   * Which server was asked.
   *
   * Most checks ask one server throughout, and this is the same every time.
   * Delegation checks ask each nameserver in turn, and "which one said that"
   * is the entire finding — a lame delegation is a fact about one server, not
   * about the zone.
   */
  readonly server: ServerAddress;
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

/**
 * The verdict a set of findings implies on its own.
 *
 * Every finding already carries a severity from the registry, so an evaluator
 * that also decides a verdict per finding is keeping the same fact in two
 * places — and the two drift, leaving a `pass` result carrying a warning nobody
 * acts on. Deriving the floor here means a new diagnosis code affects the
 * verdict the moment it is reported.
 *
 * `indeterminate` is never derived: it is a statement about what the evaluator
 * could see, not about what it found, so only the evaluator can raise it.
 */
export function verdictFromFindings(findings: readonly Finding[]): Verdict {
  let verdict: Verdict = "pass";

  for (const finding of findings) {
    if (finding.severity === "error") {
      return "fail";
    }

    if (finding.severity === "warning") {
      verdict = "warn";
    }
  }

  return verdict;
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
