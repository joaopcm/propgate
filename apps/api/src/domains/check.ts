import type {
  Database,
  DomainResult,
  DomainState,
  ProfileDefinition,
  StoredLookup,
  StoredRequirementResult,
} from "@propgate/db";
import { recordObservation, saveCheck } from "@propgate/db";
import type { CheckResult, ServerAddress } from "@propgate/dns";
import { runChecksAcrossVantagePoints } from "@propgate/dns";
import {
  attributeResults,
  compileProfile,
  overallVerdict,
} from "../profiles/compile";
import type { ScheduleIntervals } from "../sweep/schedule";
import { nextCheckAt } from "../sweep/schedule";
import { nextState, observationFor } from "./state";

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
}

export interface CheckableDomain {
  /** Registration time, which is when a never-verified domain became pending. */
  readonly createdAt: Date;
  readonly id: string;
  readonly name: string;
  readonly state: DomainState;
  readonly tenantId: string;
}

export interface CheckedDomain {
  readonly checkedAt: Date;
  readonly nextCheckAt: Date;
  readonly result: DomainResult;
  readonly state: DomainState;
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
): Promise<CheckedDomain> {
  const checked = await runChecksAcrossVantagePoints({
    domain: input.domain.name,
    profile: compileProfile(input.profile.definition, input.profile.id),
    resolver: {
      budgetMs: CHECK_BUDGET_MS,
      maxLookups: MAX_LOOKUPS,
      recursionDesired: true,
      timeoutMs: PER_QUERY_TIMEOUT_MS,
    },
    vantagePoints: input.settings.resolvers,
  });

  const requirements = attributeResults(input.profile.definition, checked);
  const overall = overallVerdict(requirements);
  const result: DomainResult = {
    checkedAt: now.toISOString(),
    lookups: storedLookups(checked),
    requirements,
    verdict: overall,
  };

  const state = nextState(input.domain.state, overall);
  const minTtlSeconds = observedMinTtlSeconds(checked);
  const scheduled = nextCheckAt({
    ...(input.settings.intervals === undefined
      ? {}
      : { intervals: input.settings.intervals }),
    ...(minTtlSeconds === undefined ? {} : { minTtlSeconds }),
    now,
    state,
    stateSince: input.domain.createdAt,
  });

  await saveCheck(
    db,
    {
      domainId: input.domain.id,
      nextCheckAt: scheduled,
      result,
      state,
      tenantId: input.domain.tenantId,
    },
    now
  );

  // An indeterminate check appends nothing at all. Recording the requirements
  // that did resolve would put half a picture on the timeline, taken while the
  // resolver was misbehaving.
  if (overall !== "indeterminate") {
    await recordChanges(db, input.domain.id, requirements);
  }

  return { checkedAt: now, nextCheckAt: scheduled, result, state };
}
