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

export const CHECK_BUDGET_MS = 10_000;
export const PER_QUERY_TIMEOUT_MS = 3000;
export const MAX_LOOKUPS = 100;

export interface CheckSettings {
  readonly intervals?: ScheduleIntervals;
  readonly resolvers: readonly ServerAddress[];
  readonly thresholds?: HysteresisThresholds;
}

export interface CheckableDomain {
  readonly configChangedAt: Date | null;
  readonly consecutiveFailures: number;
  readonly createdAt: Date;
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
  readonly transition: StateTransition | null;
}

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

interface VantageVerdict {
  readonly server: string;
  readonly verdict: string;
}

interface Assessment {
  readonly fingerprint?: string;
  readonly lookups: readonly StoredLookup[];
  readonly minTtlSeconds?: number;
  readonly requirements: readonly StoredRequirementResult[];
  readonly vantages: readonly VantageVerdict[];
}

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

  if (!saved) {
    return null;
  }

  const configMoved =
    input.domain.lastCheckedAt !== null &&
    input.domain.configChangedAt !== null &&
    input.domain.configChangedAt > input.domain.lastCheckedAt;

  if (overall !== "indeterminate" && !configMoved) {
    await recordChanges(db, input.domain.id, requirements);
  }

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
