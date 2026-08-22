import type { DiagnosisCode } from "../diagnosis/codes";
import { DIAGNOSIS_REGISTRY } from "../diagnosis/codes";
import { query } from "../transport/query";
import type { QueryOutcome } from "../transport/types";
import type { ServerAddress } from "../types";
import type { Evidence, Finding, Lookup } from "./types";

export interface EvaluationContextOptions {
  readonly budgetMs?: number;
  readonly dnssecOk?: boolean;
  readonly maxLookups?: number;
  readonly recursionDesired?: boolean;
  readonly target: ServerAddress;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_BUDGET_MS = 15_000;
const DEFAULT_MAX_LOOKUPS = 50;

export class EvaluationContext {
  private readonly options: EvaluationContextOptions;
  private readonly startedAt: number;
  private readonly recordedLookups: Lookup[] = [];
  private readonly recordedFindings: Finding[] = [];

  constructor(options: EvaluationContextOptions) {
    this.options = options;
    this.startedAt = Date.now();
  }

  get lookups(): readonly Lookup[] {
    return this.recordedLookups;
  }

  get findings(): readonly Finding[] {
    return this.recordedFindings;
  }

  get lookupsUsed(): number {
    return this.recordedLookups.length;
  }

  get remainingLookups(): number {
    return (this.options.maxLookups ?? DEFAULT_MAX_LOOKUPS) - this.lookupsUsed;
  }

  get remainingMs(): number {
    const budget = this.options.budgetMs ?? DEFAULT_BUDGET_MS;
    return Math.max(0, budget - (Date.now() - this.startedAt));
  }

  report(code: DiagnosisCode, evidence: Evidence = {}): void {
    this.recordedFindings.push({
      code,
      evidence,
      severity: DIAGNOSIS_REGISTRY[code].severity,
    });
  }

  async lookup(spec: {
    name: string;
    type: number;
    purpose: string;
    retryOverTcp?: boolean;
    ednsBufferSize?: number;
    target?: ServerAddress;
    recursionDesired?: boolean;
    checkingDisabled?: boolean;
  }): Promise<QueryOutcome> {
    const timeoutMs = Math.min(
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      this.remainingMs
    );

    const target = spec.target ?? this.options.target;

    if (this.remainingLookups <= 0 || timeoutMs <= 0) {
      const exhausted: QueryOutcome = {
        elapsedMs: 0,
        retriedOverTcp: false,
        status: "timeout",
        timeoutMs: 0,
        transport: "udp",
      };

      this.recordedLookups.push({
        name: spec.name,
        outcome: exhausted,
        purpose: `${spec.purpose} (skipped: evaluation budget exhausted)`,
        server: target,
        type: spec.type,
      });

      return exhausted;
    }

    const outcome = await query({
      checkingDisabled: spec.checkingDisabled,
      dnssecOk: this.options.dnssecOk,
      ednsBufferSize: spec.ednsBufferSize,
      name: spec.name,
      recursionDesired: spec.recursionDesired ?? this.options.recursionDesired,
      retryOverTcp: spec.retryOverTcp,
      target,
      timeoutMs,
      type: spec.type,
    });

    this.recordedLookups.push({
      name: spec.name,
      outcome,
      purpose: spec.purpose,
      server: target,
      type: spec.type,
    });

    return outcome;
  }
}

export function createEvaluationContext(
  options: EvaluationContextOptions
): EvaluationContext {
  return new EvaluationContext(options);
}
