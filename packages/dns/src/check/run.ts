import { evaluateCaa } from "../evaluate/caa";
import type { EvaluationContextOptions } from "../evaluate/context";
import { createEvaluationContext } from "../evaluate/context";
import { evaluateDelegation } from "../evaluate/delegation";
import { evaluateDkim } from "../evaluate/dkim";
import { evaluateDmarc } from "../evaluate/dmarc";
import { evaluateMx } from "../evaluate/mx";
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
import { dkimSelectorName } from "./profile";

/**
 * One domain, one answer.
 *
 * Six evaluators exist; a customer has one question. This composes them, and
 * the composition is where two decisions live that no single evaluator could
 * make:
 *
 *  1. **Checks run concurrently, each with its own context.** They share
 *     nothing and none of them is ordered relative to another, so the wall
 *     clock is the slowest check rather than their sum — which matters because
 *     the public checker is interactive. A shared context would have been
 *     simpler right up until attributing a finding to a check meant slicing an
 *     array by index, which stops working the moment anything runs in parallel.
 *  2. **A skipped check is not a passing check.** A profile that does not ask
 *     about DKIM produces no DKIM outcome at all, rather than a green one. The
 *     difference is the whole reason `checks` is explicit: a dashboard showing
 *     six ticks for a domain that was only asked about two is lying.
 *
 * The verdict is the worst of the parts, which puts `indeterminate` above
 * `warn` and below `fail`: one check that could not run makes the whole answer
 * uncertain, but a failure we did observe is more actionable than uncertainty
 * about the rest.
 */

/** One selector's own answer, inside the merged DKIM outcome. */
export interface DkimSelectorOutcome {
  readonly findings: readonly Finding[];
  readonly lookups: readonly Lookup[];
  readonly selector: string;
  readonly verdict: Verdict;
}

export interface CheckOutcome {
  readonly findings: readonly Finding[];
  readonly kind: CheckKind;
  readonly lookups: readonly Lookup[];
  /**
   * Per-selector detail. Present on the `dkim` outcome and nowhere else.
   *
   * Additive rather than a replacement for the merged verdict above, because
   * both questions are real and they are asked by different callers. "Is DKIM
   * set up" is what the public checker shows a human; "which of the three keys
   * we issued is actually published" is what a platform tracking one
   * requirement per selector needs, and it cannot be recovered from a merged
   * answer afterwards.
   */
  readonly selectors?: readonly DkimSelectorOutcome[];
  readonly verdict: Verdict;
}

export interface CheckResult {
  readonly checks: readonly CheckOutcome[];
  readonly domain: string;
  /** Every outcome's findings, flattened, in check order. */
  readonly findings: readonly Finding[];
  /** Every lookup made, across every check. The derivation. */
  readonly lookups: readonly Lookup[];
  /** The profile the domain was checked against. */
  readonly profile: string;
  readonly verdict: Verdict;
}

export interface RunOptions {
  readonly domain: string;
  readonly profile: DomainProfile;
  /**
   * Passed to every check's context.
   *
   * `budgetMs` becomes a shared deadline in practice: the contexts are created
   * together and run together, so each one's clock starts at the same moment.
   */
  readonly resolver: EvaluationContextOptions;
}

interface DkimRun extends EvaluationResult {
  readonly selectors: readonly DkimSelectorOutcome[];
}

/**
 * DKIM is per-selector, so one profile can produce several DKIM answers.
 *
 * They are merged, because a customer asked whether DKIM is set up and the
 * answer is not "yes for selector one" — and they are also kept apart, because
 * a platform that issued three keys tracks three requirements and a merged
 * verdict cannot tell it which one is missing. Both, rather than a choice.
 */
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
): Promise<DkimRun | EvaluationResult> | undefined {
  const { domain, profile, resolver } = options;
  const context = () => createEvaluationContext(resolver);

  switch (kind) {
    case "delegation":
      return evaluateDelegation(context(), { domain });

    case "spf":
      return evaluateSpf(context(), {
        domain,
        ...(profile.spfInclude === undefined
          ? {}
          : { include: profile.spfInclude }),
        ...(profile.spfIp === undefined ? {} : { ip: profile.spfIp }),
      });

    case "dkim":
      // No selectors means the platform issued none, so there is nothing to
      // check rather than something that is missing.
      return (profile.dkimSelectors ?? []).length === 0
        ? undefined
        : runDkim(options, wildcardSynthesised);

    case "dmarc":
      return evaluateDmarc(context(), { domain });

    case "mx":
      return evaluateMx(context(), {
        domain,
        ...(profile.expectsMail === undefined
          ? {}
          : { expectsMail: profile.expectsMail }),
      });

    default:
      return profile.caaIssuer === undefined
        ? undefined
        : evaluateCaa(context(), { domain, issuer: profile.caaIssuer });
  }
}

export async function runChecks(options: RunOptions): Promise<CheckResult> {
  // One probe for the whole run, before anything that could trust a synthesised
  // answer. A wildcard is a fact about the zone, so asking once is both cheaper
  // and the only way the answer can be consistent across checks.
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
        running: Promise<DkimRun | EvaluationResult>;
      } => entry.running !== undefined
    );

  const results = await Promise.all(planned.map((entry) => entry.running));

  const checks: CheckOutcome[] = planned.map((entry, index) => {
    const result = results[index];

    return {
      findings: result?.findings ?? [],
      kind: entry.kind,
      lookups: result?.lookups ?? [],
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
    // The probe's lookup belongs here even though it belongs to no check. A
    // query we made that does not appear in the derivation is a cost the caller
    // pays and cannot see, and "results carry their derivation" has to mean all
    // of them or it means nothing.
    lookups: [
      ...probeContext.lookups,
      ...checks.flatMap((check) => check.lookups),
    ],
    profile: options.profile.id,
    verdict: worstVerdict(checks.map((check) => check.verdict)),
  };
}

/** The outcome for one kind, or undefined when the profile did not ask. */
export function outcomeFor(
  result: CheckResult,
  kind: CheckKind
): CheckOutcome | undefined {
  return result.checks.find((check) => check.kind === kind);
}
