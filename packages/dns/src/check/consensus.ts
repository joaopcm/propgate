import { DIAGNOSIS_REGISTRY, DiagnosisCode } from "../diagnosis/codes";
import type { EvaluationContextOptions } from "../evaluate/context";
import type { Finding, Verdict } from "../evaluate/types";
import { worstVerdict } from "../evaluate/types";
import type { ServerAddress } from "../types";
import type { CheckKind, DomainProfile } from "./profile";
import type { CheckOutcome, CheckResult } from "./run";
import { runChecks } from "./run";

/**
 * The same domain, asked from more than one place.
 *
 * This is the highest-stakes correctness property in the product. A
 * `domain.failed` webhook fired because one resolver blipped makes our customers
 * page *their* customers for nothing, so a single disagreeing vantage point must
 * never be able to produce a failure on its own.
 *
 * The rule is that disagreement is **uncertainty, not failure**. When the
 * vantage points cannot be reconciled the verdict is `indeterminate`, which is
 * the verdict this codebase already has for "we could not tell" and which
 * `nextState` deliberately treats as no state change at all. That is the same
 * four-valued discipline every evaluator follows, applied one level up.
 *
 * **What this can and cannot see.** Several resolvers reached from one machine
 * share an egress IP, so they are only weakly independent: they catch cache
 * state, propagation lag and one resolver being broken. They cannot see GeoDNS,
 * anycast, or a network path that differs by geography — a domain answering
 * differently in Frankfurt than in São Paulo looks identical from here. The docs
 * must not imply otherwise.
 */

/** One vantage point's full result, kept so the derivation survives. */
export interface VantageResult {
  readonly result: CheckResult;
  readonly vantagePoint: ServerAddress;
}

export interface ConsensusOptions {
  readonly domain: string;
  readonly profile: DomainProfile;
  /** Everything about how to resolve except *where*, which each vantage supplies. */
  readonly resolver: Omit<EvaluationContextOptions, "target">;
  readonly vantagePoints: readonly ServerAddress[];
}

export interface ConsensusResult extends CheckResult {
  /** Every vantage point's own answer, for a caller that wants the evidence. */
  readonly vantages: readonly VantageResult[];
}

function addressOf(server: ServerAddress): string {
  return `${server.address}:${server.port}`;
}

/**
 * What "the same answer" means.
 *
 * The verdict plus the sorted finding codes, which is the same shape
 * `observationFor` uses to decide whether a requirement changed. Deliberately
 * not the raw records: two resolvers legitimately return an RRset in different
 * orders and with different remaining TTLs, and calling that a divergence would
 * fire on every healthy domain — the failure mode this whole codebase is most
 * careful about.
 */
function signatureOf(outcome: CheckOutcome | undefined): string {
  if (outcome === undefined) {
    return "absent";
  }

  const codes = [...outcome.findings.map((finding) => finding.code)].sort();

  return `${outcome.verdict}:${codes.join(",")}`;
}

function divergenceFinding(
  kind: CheckKind,
  signatures: Map<string, ServerAddress[]>
): Finding {
  const parts = [...signatures.entries()].map(
    ([signature, servers]) =>
      `${servers.map(addressOf).join(", ")} saw ${signature}`
  );

  return {
    code: DiagnosisCode.ANSWER_DIVERGES_BY_VANTAGE_POINT,
    evidence: {
      detail:
        "different vantage points disagree about this name, so a verification result taken from any one of them may not be what a customer's own resolver sees; this is usually mid-propagation and usually resolves on its own",
      expected: "the same answer from every vantage point",
      observed: `${kind}: ${parts.join("; ")}`,
    },
    severity: DIAGNOSIS_REGISTRY.ANSWER_DIVERGES_BY_VANTAGE_POINT.severity,
  };
}

/**
 * Reconcile one check across the vantage points.
 *
 * A strict majority wins, which is the point of having three rather than two: one
 * resolver serving a stale or broken answer is outvoted instead of being able to
 * make the whole check uncertain. The divergence is still reported, because a
 * customer whose domain is mid-propagation should be told that rather than left
 * to wonder why the answer changed.
 *
 * With no strict majority — two vantage points that disagree, or a three-way
 * split — there is nothing to believe, and `indeterminate` is the honest answer.
 */
function reconcile(
  kind: CheckKind,
  outcomes: readonly {
    outcome: CheckOutcome | undefined;
    server: ServerAddress;
  }[]
): CheckOutcome | undefined {
  const signatures = new Map<string, ServerAddress[]>();

  for (const entry of outcomes) {
    const signature = signatureOf(entry.outcome);

    signatures.set(signature, [
      ...(signatures.get(signature) ?? []),
      entry.server,
    ]);
  }

  if (signatures.size === 1) {
    // Unanimous. Nothing to say and nothing to downgrade.
    return outcomes[0]?.outcome;
  }

  const finding = divergenceFinding(kind, signatures);
  const majority = [...signatures.entries()].find(
    ([, servers]) => servers.length * 2 > outcomes.length
  );

  if (majority === undefined) {
    // No majority. The check ran, so its lookups are real and worth keeping, but
    // the verdict is not something we know.
    const first = outcomes[0]?.outcome;

    return {
      findings: [...(first?.findings ?? []), finding],
      kind,
      lookups: first?.lookups ?? [],
      verdict: "indeterminate",
    };
  }

  const winner = outcomes.find(
    (entry) => signatureOf(entry.outcome) === majority[0]
  )?.outcome;

  if (winner === undefined) {
    return;
  }

  return {
    ...winner,
    findings: [...winner.findings, finding],
    // Raised to at least `warn`, because a check carrying a warning finding while
    // reporting `pass` would be inconsistent with how every evaluator here maps
    // severity to verdict.
    verdict: worstVerdict([winner.verdict, "warn" as Verdict]),
  };
}

export async function runChecksAcrossVantagePoints(
  options: ConsensusOptions
): Promise<ConsensusResult> {
  if (options.vantagePoints.length === 0) {
    throw new Error(
      "runChecksAcrossVantagePoints needs at least one vantage point; got none"
    );
  }

  // Concurrently, so the wall clock is the slowest vantage point rather than
  // their sum. This is what makes consensus affordable on an interactive verify:
  // three resolvers cost roughly 1.2-1.5x one, not 3x.
  const vantages = await Promise.all(
    options.vantagePoints.map(async (vantagePoint) => ({
      result: await runChecks({
        domain: options.domain,
        profile: options.profile,
        resolver: { ...options.resolver, target: vantagePoint },
      }),
      vantagePoint,
    }))
  );

  const checks = options.profile.checks
    .map((kind) =>
      reconcile(
        kind,
        vantages.map((vantage) => ({
          outcome: vantage.result.checks.find((check) => check.kind === kind),
          server: vantage.vantagePoint,
        }))
      )
    )
    .filter((outcome): outcome is CheckOutcome => outcome !== undefined);

  return {
    checks,
    domain: options.domain,
    findings: checks.flatMap((check) => check.findings),
    /**
     * Every lookup from every vantage point.
     *
     * All of them, not just the winner's. A query we made that does not appear in
     * the derivation is a cost the caller pays and cannot see, and when the
     * question is "why do you say this is uncertain" the losing vantage point's
     * lookups are the entire answer.
     */
    lookups: vantages.flatMap((vantage) => vantage.result.lookups),
    profile: options.profile.id,
    vantages,
    verdict: worstVerdict(checks.map((check) => check.verdict)),
  };
}
