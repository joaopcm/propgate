import { DIAGNOSIS_REGISTRY, DiagnosisCode } from "../diagnosis/codes";
import type { EvaluationContextOptions } from "../evaluate/context";
import type { Finding, Verdict } from "../evaluate/types";
import { worstVerdict } from "../evaluate/types";
import type { ServerAddress } from "../types";
import type { CheckKind, DomainProfile } from "./profile";
import type { CheckOutcome, CheckResult } from "./run";
import { runChecks } from "./run";

export interface VantageResult {
  readonly result: CheckResult;
  readonly vantagePoint: ServerAddress;
}

export interface ConsensusOptions {
  readonly domain: string;
  readonly profile: DomainProfile;
  readonly resolver: Omit<EvaluationContextOptions, "target">;
  readonly vantagePoints: readonly ServerAddress[];
}

export interface ConsensusResult extends CheckResult {
  readonly vantages: readonly VantageResult[];
}

function addressOf(server: ServerAddress): string {
  return `${server.address}:${server.port}`;
}

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
    return outcomes[0]?.outcome;
  }

  const finding = divergenceFinding(kind, signatures);
  const majority = [...signatures.entries()].find(
    ([, servers]) => servers.length * 2 > outcomes.length
  );

  if (majority === undefined) {
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
    lookups: vantages.flatMap((vantage) => vantage.result.lookups),
    profile: options.profile.id,
    vantages,
    verdict: worstVerdict(checks.map((check) => check.verdict)),
  };
}
