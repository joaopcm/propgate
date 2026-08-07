import type {
  Database,
  DomainExpectations,
  DomainResult,
  DomainState,
  ProfileDefinition,
  StoredLookup,
  StoredRequirementResult,
} from "@propgate/db";
import { recordObservation, recordTransition, saveCheck } from "@propgate/db";
import type { CheckResult, ServerAddress } from "@propgate/dns";
import { runChecksAcrossVantagePoints } from "@propgate/dns";
import {
  attributeMissing,
  attributeResults,
  compileProfile,
  overallVerdict,
} from "../profiles/compile";
import type { ScheduleIntervals } from "../sweep/schedule";
import { nextCheckAt } from "../sweep/schedule";
import type { HysteresisThresholds, StateTransition } from "./hysteresis";
import { applyHysteresis } from "./hysteresis";
import { observationFor } from "./state";

/**
 * One check, run and persisted, for both callers.
 *
 * `POST /v1/domains/:id/checks` and the sweeper must produce byte-identical
 * results. Two code paths that each build a `DomainResult` is a product with two
 * opinions about the same domain — a customer clicks verify, gets `verified`,
 * and the sweeper contradicts it sixty seconds later because one path forgot to
 * store lookups or computed the next check differently. Sharing this function is
 * what makes that impossible rather than merely unlikely.
 *
 * It deliberately does *not* handle authorization, rate limiting or HTTP. Those
 * belong to the route and have no meaning for the sweeper.
 */

/** Past what any real check needs. Six checks run concurrently, not in series. */
export const CHECK_BUDGET_MS = 10_000;
export const PER_QUERY_TIMEOUT_MS = 3000;
/** A backstop against a pathological zone, not a limit any evaluator enforces. */
export const MAX_LOOKUPS = 100;

export interface CheckSettings {
  readonly intervals?: ScheduleIntervals;
  /**
   * The vantage points, queried concurrently and reconciled.
   *
   * A pool rather than one address, and the same pool for the sweeper and for
   * `POST /v1/domains/:id/checks`. A verify that consulted one resolver could be
   * contradicted by the sweeper a minute later, and a product with two opinions
   * about one domain is worse than a slightly slower one. Concurrency is what
   * makes that affordable: the wall clock is the slowest resolver, not the sum.
   *
   * The unauthenticated `/v1/checks` deliberately stays single-resolver. It
   * tracks no state, so it has nothing to contradict.
   */
  readonly resolvers: readonly ServerAddress[];
  /** How many consecutive failures it takes to believe one. Invariant 2. */
  readonly thresholds?: HysteresisThresholds;
}

export interface CheckableDomain {
  /**
   * When this domain's values or its pinned profile last changed.
   *
   * Null for a row registered before the column existed, where `createdAt` is the
   * right stand-in — registration is when a domain's configuration was set.
   */
  readonly configChangedAt: Date | null;
  readonly consecutiveFailures: number;
  /** Registration time, which is when a never-verified domain became pending. */
  readonly createdAt: Date;
  /**
   * The values behind the profile's `requiredPerDomain` declarations.
   *
   * Required rather than optional, and null is the way to say "none". Both
   * callers build this by spreading a `DomainRow`, so an optional field would let
   * them keep compiling while passing nothing — and passing nothing used to be
   * indistinguishable from "any valid key is fine". The type is the only thing
   * that catches that.
   */
  readonly expectations: DomainExpectations | null;
  readonly id: string;
  readonly lastCheckedAt: Date | null;
  readonly name: string;
  readonly state: DomainState;
  readonly tenantId: string;
}

export interface CheckedDomain {
  readonly checkedAt: Date;
  readonly consecutiveFailures: number;
  readonly nextCheckAt: Date;
  readonly result: DomainResult;
  readonly state: DomainState;
  /** Null unless the domain actually moved. Phase 5 turns this into a webhook. */
  readonly transition: StateTransition | null;
}

/**
 * `lookups` is opt-in on the list endpoint because that is the size-sensitive
 * path: 389 bytes a domain without them, 1,728 with. Stored either way, because
 * "why did you say that" is the question a disputed verdict produces.
 */
function storedLookups(checked: CheckResult): readonly StoredLookup[] {
  return checked.checks.flatMap((check) =>
    check.lookups.map((lookup) => ({
      name: lookup.name,
      purpose: lookup.purpose,
      server: `${lookup.server.address}:${lookup.server.port}`,
      status: lookup.outcome.status,
      type: lookup.type,
    }))
  );
}

/**
 * The shortest TTL anything in this check was published with.
 *
 * The minimum rather than an average: the fastest-moving record sets how often
 * the answer can change, and a long-lived NS record alongside a five-minute TXT
 * does not make the TXT slower to move. Only used as a floor on the *verified*
 * cadence — see `nextCheckAt` for why it must not apply while pending.
 *
 * Undefined when nothing was answered, which is the honest reading of a check
 * that reached no records: there is no observed TTL to respect.
 */
function observedMinTtlSeconds(checked: CheckResult): number | undefined {
  let smallest: number | undefined;

  for (const lookup of checked.lookups) {
    if (lookup.outcome.status !== "answered") {
      continue;
    }

    for (const record of lookup.outcome.message.answers) {
      if (smallest === undefined || record.ttl < smallest) {
        smallest = record.ttl;
      }
    }
  }

  return smallest;
}

/**
 * Write down what changed, and only what changed.
 *
 * Nothing is appended for a requirement we could not evaluate. A timeline entry
 * saying a record "changed" to uncertainty is worse than a gap: the gap is
 * honest and the entry is a claim about the zone that nobody observed.
 */
async function recordChanges(
  db: Database,
  domainId: string,
  requirements: readonly StoredRequirementResult[]
): Promise<void> {
  const definite = requirements.filter(
    (requirement) => requirement.verdict !== "indeterminate"
  );

  await Promise.all(
    definite.map((requirement) =>
      recordObservation(db, {
        domainId,
        observed: observationFor(requirement),
        requirementKey: requirement.key,
      })
    )
  );
}

/** One vantage point's conclusion, as the transition evidence records it. */
interface VantageVerdict {
  readonly server: string;
  readonly verdict: string;
}

/**
 * What a check concluded, from DNS or from refusing to ask.
 *
 * The two paths converge here so everything downstream — hysteresis, scheduling,
 * the row, the transition — has exactly one shape to handle. A domain we cannot
 * judge must still be scheduled and still be stored, and forking the persistence
 * is how one of those gets forgotten.
 */
interface Assessment {
  readonly fingerprint?: string;
  readonly lookups: readonly StoredLookup[];
  readonly minTtlSeconds?: number;
  readonly requirements: readonly StoredRequirementResult[];
  readonly vantages: readonly VantageVerdict[];
}

/**
 * A profile whose values are not all here yet cannot be evaluated at all.
 *
 * No DNS is sent, deliberately. `overallVerdict` folds with `worstVerdict`, which
 * ranks `indeterminate` above `warn`, so running the requirements that *are*
 * complete cannot change the overall verdict, cannot move the state, and cannot
 * append to the timeline. It would only spend up to nineteen upstream queries per
 * check against a domain we knew in advance we could not judge — and an
 * incomplete domain never fixes itself, so that spend never stops.
 *
 * What it does cost is a dashboard that says nothing about DMARC on a domain whose
 * only fault is a missing DKIM key. That is the trade, and it is the cheap side.
 */
function assessIncomplete(
  definition: ProfileDefinition,
  missing: readonly {
    readonly field: string;
    readonly requirementKey: string;
  }[]
): Assessment {
  return {
    lookups: [],
    requirements: attributeMissing(
      definition,
      missing as Parameters<typeof attributeMissing>[1]
    ),
    vantages: [],
  };
}

/**
 * Runs a check and stores it, or returns null because the answer went stale.
 *
 * Null means the domain's configuration changed while the DNS was in flight — a
 * key rotated or a profile re-pointed — so this result describes values the row no
 * longer holds and nothing was written. The domain is already `pending` and due,
 * so the next check answers the current question.
 */
export async function checkAndPersist(
  db: Database,
  input: {
    readonly domain: CheckableDomain;
    readonly profile: {
      readonly definition: ProfileDefinition;
      readonly id: string;
    };
    readonly settings: CheckSettings;
  },
  now = new Date()
): Promise<CheckedDomain | null> {
  const compiled = compileProfile(
    input.profile.definition,
    input.profile.id,
    input.domain.expectations
  );

  let assessment: Assessment;

  if (compiled.kind === "incomplete") {
    assessment = assessIncomplete(input.profile.definition, compiled.missing);
  } else {
    const checked = await runChecksAcrossVantagePoints({
      domain: input.domain.name,
      profile: compiled.profile,
      resolver: {
        budgetMs: CHECK_BUDGET_MS,
        maxLookups: MAX_LOOKUPS,
        recursionDesired: true,
        timeoutMs: PER_QUERY_TIMEOUT_MS,
      },
      vantagePoints: input.settings.resolvers,
    });
    const minTtlSeconds = observedMinTtlSeconds(checked);

    assessment = {
      fingerprint: compiled.fingerprint,
      lookups: storedLookups(checked),
      ...(minTtlSeconds === undefined ? {} : { minTtlSeconds }),
      requirements: attributeResults(
        input.profile.definition,
        checked,
        input.domain.expectations
      ),
      vantages: checked.vantages.map((vantage) => ({
        server: `${vantage.vantagePoint.address}:${vantage.vantagePoint.port}`,
        verdict: vantage.result.verdict,
      })),
    };
  }

  const { requirements } = assessment;
  const overall = overallVerdict(requirements);
  const result: DomainResult = {
    checkedAt: now.toISOString(),
    ...(assessment.fingerprint === undefined
      ? {}
      : { expectationsFingerprint: assessment.fingerprint }),
    lookups: assessment.lookups,
    requirements,
    verdict: overall,
  };

  const hysteresis = applyHysteresis({
    consecutiveFailures: input.domain.consecutiveFailures,
    state: input.domain.state,
    ...(input.settings.thresholds === undefined
      ? {}
      : { thresholds: input.settings.thresholds }),
    verdict: overall,
  });
  const { state } = hysteresis;
  const scheduled = nextCheckAt({
    ...(input.settings.intervals === undefined
      ? {}
      : { intervals: input.settings.intervals }),
    ...(assessment.minTtlSeconds === undefined
      ? {}
      : { minTtlSeconds: assessment.minTtlSeconds }),
    now,
    state,
    // A config change is the most recent thing that made this domain pending, so
    // it is what the fast-pending window should be measured from. Falling back to
    // registration for a row that predates the column, which has never had its
    // config changed and so is correctly measured from there.
    stateSince: input.domain.configChangedAt ?? input.domain.createdAt,
  });

  const saved = await saveCheck(
    db,
    {
      configChangedAt: input.domain.configChangedAt,
      consecutiveFailures: hysteresis.consecutiveFailures,
      domainId: input.domain.id,
      nextCheckAt: scheduled,
      result,
      state,
      tenantId: input.domain.tenantId,
    },
    now
  );

  /**
   * The configuration moved while this check was in flight, so it is discarded.
   *
   * `saveCheck` is a compare-and-set on `config_changed_at`, and it wrote nothing.
   * Everything below writes *about* a row that no longer holds the values this
   * verdict was computed against — a timeline entry, a transition, and the webhook
   * the transition owes. Storing any of them would announce a state for a
   * configuration nothing has checked, which is the failure the compare-and-set
   * exists to prevent, moved one statement later.
   *
   * Nothing needs rescheduling: `updateDomainConfig` left the domain `pending`
   * and due, so the next tick picks it up against the new values.
   */
  if (!saved) {
    return null;
  }

  /**
   * The timeline records what the *customer's* zone did, so two checks are
   * silent.
   *
   * An indeterminate check appends nothing at all: recording the requirements
   * that did resolve would put half a picture on the timeline, taken while the
   * resolver was misbehaving.
   *
   * The first check after a config change appends nothing either. The compared
   * value moved because we rotated a key or re-pointed the profile, and writing
   * "the DKIM record changed Tuesday at 14:02" into the surface built to deflect
   * support tickets — about a zone that did not move — is worse than a gap. The
   * next check resumes normally with the new value as its baseline.
   */
  const configMoved =
    input.domain.lastCheckedAt !== null &&
    input.domain.configChangedAt !== null &&
    input.domain.configChangedAt > input.domain.lastCheckedAt;

  if (overall !== "indeterminate" && !configMoved) {
    await recordChanges(db, input.domain.id, requirements);
  }

  /**
   * Written after the check is persisted and before anything is sent.
   *
   * The order matters: a transition row referring to a state the domain is not
   * yet in would be a lie for however long the two writes are apart, and Phase 5
   * reads this table to decide which webhooks are owed.
   */
  if (hysteresis.transition !== null) {
    await recordTransition(db, {
      domainId: input.domain.id,
      evidence: {
        codes: requirements.flatMap((requirement) =>
          requirement.findings.map((finding) => finding.code)
        ),
        consecutiveFailures: hysteresis.consecutiveFailures,
        vantages: assessment.vantages,
        verdict: overall,
      },
      fromState: hysteresis.transition.from,
      reason: hysteresis.transition.reason,
      toState: hysteresis.transition.to,
    });
  }

  return {
    checkedAt: now,
    consecutiveFailures: hysteresis.consecutiveFailures,
    nextCheckAt: scheduled,
    result,
    state,
    transition: hysteresis.transition,
  };
}
