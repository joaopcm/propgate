import type { DiagnosisCode, DiagnosisSeverity } from "../diagnosis/codes";
import type { QueryOutcome } from "../transport/types";
import type { ServerAddress } from "../types";

export interface Lookup {
  readonly name: string;
  readonly outcome: QueryOutcome;
  readonly purpose: string;
  readonly server: ServerAddress;
  readonly type: number;
}

export interface Evidence {
  readonly detail?: string;
  readonly expected?: string;
  readonly name?: string;
  readonly observed?: string;
}

export interface Finding {
  readonly code: DiagnosisCode;
  readonly evidence: Evidence;
  readonly severity: DiagnosisSeverity;
}

export type Verdict = "pass" | "fail" | "warn" | "indeterminate";

export interface EvaluationResult {
  readonly findings: readonly Finding[];
  readonly lookups: readonly Lookup[];
  readonly verdict: Verdict;
}

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

const VERDICT_RANK: Readonly<Record<Verdict, number>> = {
  fail: 3,
  indeterminate: 2,
  pass: 0,
  warn: 1,
};

export function worstVerdict(verdicts: readonly Verdict[]): Verdict {
  let worst: Verdict = "pass";

  for (const verdict of verdicts) {
    if (VERDICT_RANK[verdict] > VERDICT_RANK[worst]) {
      worst = verdict;
    }
  }

  return worst;
}
