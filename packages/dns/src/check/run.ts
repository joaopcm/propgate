import { evaluateCaa } from "../evaluate/caa";
import { evaluateCname } from "../evaluate/cname";
import type { EvaluationContextOptions } from "../evaluate/context";
import { createEvaluationContext } from "../evaluate/context";
import { evaluateDelegation } from "../evaluate/delegation";
import { evaluateDkim } from "../evaluate/dkim";
import { evaluateDmarc } from "../evaluate/dmarc";
import { evaluateMx } from "../evaluate/mx";
import { evaluateOwnership } from "../evaluate/ownership";
import { evaluateSpf } from "../evaluate/spf";
import type {
  EvaluationResult,
  Finding,
  Lookup,
  Verdict,
} from "../evaluate/types";
import { worstVerdict } from "../evaluate/types";
import { probeWildcard } from "../evaluate/wildcard";
import type { CheckKind, DomainProfile } from "./profile";
import { dkimSelectorName, nameAt, ownershipLabel } from "./profile";

export interface DkimSelectorOutcome {
  readonly findings: readonly Finding[];
  readonly lookups: readonly Lookup[];
  readonly selector: string;
  readonly verdict: Verdict;
}

export interface RecordOutcome {
  readonly findings: readonly Finding[];
  readonly label: string;
  readonly lookups: readonly Lookup[];
  readonly verdict: Verdict;
}

export interface CheckOutcome {
  readonly findings: readonly Finding[];
  readonly kind: CheckKind;
  readonly lookups: readonly Lookup[];
  readonly records?: readonly RecordOutcome[];
  readonly selectors?: readonly DkimSelectorOutcome[];
  readonly verdict: Verdict;
}

export interface CheckResult {
  readonly checks: readonly CheckOutcome[];
  readonly domain: string;
  readonly findings: readonly Finding[];
  readonly lookups: readonly Lookup[];
  readonly profile: string;
  readonly verdict: Verdict;
}

export interface RunOptions {
  readonly domain: string;
  readonly profile: DomainProfile;
  readonly resolver: EvaluationContextOptions;
}

interface DkimRun extends EvaluationResult {
  readonly selectors: readonly DkimSelectorOutcome[];
}

interface RecordRun extends EvaluationResult {
  readonly records: readonly RecordOutcome[];
}

async function runPerRecord<T>(
  entries: readonly T[],
  labelOf: (entry: T) => string,
  resolver: EvaluationContextOptions,
  evaluate: (
    context: ReturnType<typeof createEvaluationContext>,
    entry: T
  ) => Promise<EvaluationResult>
): Promise<RecordRun> {
  const records = await Promise.all(
    entries.map(async (entry) => ({
      ...(await evaluate(createEvaluationContext(resolver), entry)),
      label: labelOf(entry),
    }))
  );

  return {
    findings: records.flatMap((record) => record.findings),
    lookups: records.flatMap((record) => record.lookups),
    records,
    verdict: worstVerdict(records.map((record) => record.verdict)),
  };
}

function apexOrLabel(entry: { readonly label?: string }): string {
  return entry.label ?? "";
}

function atLeastOne<T>(
  entries: readonly T[] | undefined,
  apex: T
): readonly T[] {
  return entries === undefined || entries.length === 0 ? [apex] : entries;
}

async function runDkim(
  options: RunOptions,
  wildcardSynthesised: boolean
): Promise<DkimRun> {
  const selectors = options.profile.dkimSelectors ?? [];
  const results = await Promise.all(
    selectors.map(async (selector) => {
      const name = dkimSelectorName(selector);
      const expectedPublicKey =
        typeof selector === "string" ? undefined : selector.expectedPublicKey;

      const result = await evaluateDkim(
        createEvaluationContext(options.resolver),
        {
          domain: options.domain,
          selector: name,
          ...(expectedPublicKey === undefined ? {} : { expectedPublicKey }),
          ...(wildcardSynthesised ? { wildcardSynthesised } : {}),
        }
      );

      return { ...result, selector: name };
    })
  );

  return {
    findings: results.flatMap((result) => result.findings),
    lookups: results.flatMap((result) => result.lookups),
    selectors: results,
    verdict: worstVerdict(results.map((result) => result.verdict)),
  };
}

function runOne(
  kind: CheckKind,
  options: RunOptions,
  wildcardSynthesised: boolean
): Promise<DkimRun | RecordRun | EvaluationResult> | undefined {
  const { domain, profile, resolver } = options;
  const context = () => createEvaluationContext(resolver);

  // biome-ignore lint/style/useDefaultSwitchClause: the omission is the point. Exhaustive over `CheckKind`, so a ninth kind fails `tsc` here — where somebody has to decide what running it means — rather than falling into a default that returns undefined, which reads downstream as a skipped check and looks exactly like a profile that never asked.
  switch (kind) {
    case "delegation":
      return evaluateDelegation(context(), { domain });

    case "spf":
      return runPerRecord(
        atLeastOne(profile.spf, {}),
        apexOrLabel,
        resolver,
        (evaluation, entry) =>
          evaluateSpf(evaluation, {
            domain: nameAt(entry.label, domain),
            ...(entry.include === undefined ? {} : { include: entry.include }),
            ...(entry.ip === undefined ? {} : { ip: entry.ip }),
          })
      );

    case "dkim":
      return (profile.dkimSelectors ?? []).length === 0
        ? undefined
        : runDkim(options, wildcardSynthesised);

    case "dmarc":
      return evaluateDmarc(context(), { domain });

    case "mx":
      return runPerRecord(
        atLeastOne(profile.mx, {}),
        apexOrLabel,
        resolver,
        (evaluation, entry) =>
          evaluateMx(evaluation, {
            domain: nameAt(entry.label, domain),
            ...(entry.expectsMail === undefined
              ? {}
              : { expectsMail: entry.expectsMail }),
          })
      );

    case "caa":
      return profile.caaIssuer === undefined
        ? undefined
        : evaluateCaa(context(), { domain, issuer: profile.caaIssuer });

    case "ownership":
      return (profile.ownership ?? []).length === 0
        ? undefined
        : runPerRecord(
            profile.ownership ?? [],
            ownershipLabel,
            resolver,
            (evaluation, token) =>
              evaluateOwnership(evaluation, {
                domain,
                token: token.token,
                ...(token.label === undefined ? {} : { label: token.label }),
              })
          );

    case "cname":
      return (profile.cnames ?? []).length === 0
        ? undefined
        : runPerRecord(
            profile.cnames ?? [],
            (alias) => alias.label,
            resolver,
            (evaluation, alias) =>
              evaluateCname(evaluation, {
                domain,
                label: alias.label,
                target: alias.target,
              })
          );
  }
}

export async function runChecks(options: RunOptions): Promise<CheckResult> {
  const probeContext = createEvaluationContext(options.resolver);
  const wildcard = options.profile.checks.includes("dkim")
    ? await probeWildcard(probeContext, options.domain)
    : { probed: "", synthesises: false };

  const planned = options.profile.checks
    .map((kind) => ({
      kind,
      running: runOne(kind, options, wildcard.synthesises),
    }))
    .filter(
      (
        entry
      ): entry is {
        kind: CheckKind;
        running: Promise<DkimRun | RecordRun | EvaluationResult>;
      } => entry.running !== undefined
    );

  const results = await Promise.all(planned.map((entry) => entry.running));

  const checks: CheckOutcome[] = planned.map((entry, index) => {
    const result = results[index];

    return {
      findings: result?.findings ?? [],
      kind: entry.kind,
      lookups: result?.lookups ?? [],
      ...(result !== undefined && "records" in result
        ? { records: result.records }
        : {}),
      ...(result !== undefined && "selectors" in result
        ? { selectors: result.selectors }
        : {}),
      verdict: result?.verdict ?? "indeterminate",
    };
  });

  return {
    checks,
    domain: options.domain,
    findings: checks.flatMap((check) => check.findings),
    lookups: [
      ...probeContext.lookups,
      ...checks.flatMap((check) => check.lookups),
    ],
    profile: options.profile.id,
    verdict: worstVerdict(checks.map((check) => check.verdict)),
  };
}

export function outcomeFor(
  result: CheckResult,
  kind: CheckKind
): CheckOutcome | undefined {
  return result.checks.find((check) => check.kind === kind);
}
