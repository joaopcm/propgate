import type { DiagnosisCode } from "../diagnosis/codes";
import { DIAGNOSIS_REGISTRY } from "../diagnosis/codes";
import { query } from "../transport/query";
import type { QueryOutcome } from "../transport/types";
import type { ServerAddress } from "../types";
import type { Evidence, Finding, Lookup } from "./types";

/**
 * Shared state for one evaluation.
 *
 * Evaluators do not call `query()` directly. They go through a context so that
 * three things are possible, none of which a bare function call can provide:
 *
 *  - **A shared lookup budget.** SPF's limit is 10 lookups *per evaluation*,
 *    not per record, and it has to survive recursive `include:` expansion. That
 *    counter has to live somewhere above the evaluator.
 *  - **A shared deadline.** A check that takes 30 seconds because each of six
 *    lookups waited 5 is a check nobody will run interactively.
 *  - **The derivation.** Every lookup is recorded with the reason it happened,
 *    which is what turns a verdict into an explanation.
 *
 * DKIM needs only the last of these today. The seam exists now because
 * retrofitting a budget through an evaluator written against `query()` means
 * rewriting it, and SPF is two evaluators away.
 */

export interface EvaluationContextOptions {
  /**
   * Whole-evaluation deadline. Once passed, further lookups short-circuit to a
   * timeout outcome rather than starting.
   */
  readonly budgetMs?: number;
  /** Request DNSSEC records, so RRSIG-based signals are available. */
  readonly dnssecOk?: boolean;
  /**
   * Total DNS lookups allowed across the evaluation.
   *
   * Not the SPF limit — that is a stricter sub-budget SPF will enforce itself.
   * This is a backstop so a pathological zone (a deep CNAME chain, a wide
   * `include:` tree) cannot make one check run forever.
   */
  readonly maxLookups?: number;
  /** Talking to a recursive resolver rather than an authoritative server. */
  readonly recursionDesired?: boolean;
  /** Where to send queries. Phase 2 fans this out across vantage points. */
  readonly target: ServerAddress;
  /** Per-query deadline. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_BUDGET_MS = 15_000;
/**
 * Generous on purpose. This is a tripwire, not a design constraint: a good
 * domain never comes close, and if a real one does, the number is wrong and
 * should be re-measured rather than worked around.
 */
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

  /**
   * Record a finding. Severity comes from the registry rather than the call
   * site, so the same code cannot be an error in one evaluator and a warning in
   * another — consumers switch on these, and inconsistency would make that
   * switch a lie.
   */
  report(code: DiagnosisCode, evidence: Evidence = {}): void {
    this.recordedFindings.push({
      code,
      evidence,
      severity: DIAGNOSIS_REGISTRY[code].severity,
    });
  }

  /**
   * Run a lookup, recording it and its purpose.
   *
   * Exhausting the budget or the deadline yields a timeout outcome rather than
   * a throw, because from the caller's perspective "we ran out of time" and
   * "the server did not answer" are the same kind of fact: we could not tell.
   * Both must land as `indeterminate`, never as a failure.
   */
  async lookup(spec: {
    name: string;
    type: number;
    purpose: string;
    /** Omit OPT entirely, to observe truncation rather than resolve past it. */
    retryOverTcp?: boolean;
    ednsBufferSize?: number;
  }): Promise<QueryOutcome> {
    const timeoutMs = Math.min(
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      this.remainingMs
    );

    if (this.remainingLookups <= 0 || timeoutMs <= 0) {
      const exhausted: QueryOutcome = {
        elapsedMs: 0,
        status: "timeout",
        timeoutMs: 0,
        transport: "udp",
      };

      this.recordedLookups.push({
        name: spec.name,
        outcome: exhausted,
        purpose: `${spec.purpose} (skipped: evaluation budget exhausted)`,
        type: spec.type,
      });

      return exhausted;
    }

    const outcome = await query({
      dnssecOk: this.options.dnssecOk,
      ednsBufferSize: spec.ednsBufferSize,
      name: spec.name,
      recursionDesired: this.options.recursionDesired,
      retryOverTcp: spec.retryOverTcp,
      target: this.options.target,
      timeoutMs,
      type: spec.type,
    });

    this.recordedLookups.push({
      name: spec.name,
      outcome,
      purpose: spec.purpose,
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
