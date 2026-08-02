import type {
  Database,
  DomainResult,
  DomainRow,
  DomainState,
  StoredLookup,
} from "@propgate/db";
import {
  currentProfileVersion,
  deleteDomain,
  domainById,
  domainTimeline,
  listDomains,
  profileVersionById,
  recordObservation,
  registerDomain,
  saveCheck,
} from "@propgate/db";
import type { CheckResult, ServerAddress } from "@propgate/dns";
import { runChecks } from "@propgate/dns";
import { Hono } from "hono";
import { z } from "zod";
import { nextState, observationFor } from "../domains/state";
import type { AuthVariables } from "../middleware/auth";
import type { RequirementResult } from "../profiles/compile";
import {
  attributeResults,
  compileProfile,
  overallVerdict,
} from "../profiles/compile";
import {
  MAX_DOMAIN_LENGTH,
  normaliseDomain,
  rejectDomain,
} from "../utils/domain-name";
import type { RateLimiter } from "../utils/rate-limit";
import { error, success } from "../utils/response";

/**
 * The domain lifecycle: register, verify, read, delete.
 *
 * Registration and verification are separate calls on purpose. Registration is
 * a write; verification is an action with latency and side effects. Importing
 * tens of thousands of domains must not fire tens of thousands of DNS runs as a
 * side effect of a bulk insert, and a registration that is slow because DNS is
 * slow is a registration that times out for reasons unrelated to registering.
 */

/**
 * The receipt, from `POST /v1/checks`: a healthy sending-only domain costs
 * **10 lookups** and returns in **23 ms**; one near SPF's ten-lookup limit
 * costs **19**.
 *
 * Ten checks a second from one tenant is therefore up to ~190 upstream queries
 * a second, aimed at whatever authoritative servers their customers use. That
 * is generous for verification at onboarding, which is what this endpoint is
 * for — a customer clicking "verify" — and it makes bulk re-verification of ten
 * thousand domains take seventeen minutes, which is the right shape for
 * something that should be the sweeper's job in milestone 2 rather than a loop
 * against this route.
 */
export const CHECKS_PER_TENANT_PER_MINUTE = 600;
export const CHECK_RATE_LIMIT_WINDOW_MS = 60_000;

/** Past what any real check needs. Six checks run concurrently, not in series. */
const CHECK_BUDGET_MS = 10_000;
const PER_QUERY_TIMEOUT_MS = 3000;
/** A backstop against a pathological zone, not a limit any evaluator enforces. */
const MAX_LOOKUPS = 100;

const MAX_EXTERNAL_ID_LENGTH = 255;
const MAX_PROFILE_KEY_LENGTH = 64;
const DEFAULT_TIMELINE_LIMIT = 50;
const MAX_TIMELINE_LIMIT = 200;

/**
 * Measured on this schema: a stored result is 389 bytes without its lookups.
 * Two hundred of those is a 78 KB page, and reconciling ten thousand domains
 * takes fifty round trips — comfortably inside the per-tenant rate limit. The
 * list deliberately omits `lookups`, which would multiply the page by 4.4.
 */
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

const DOMAIN_STATES: readonly DomainState[] = [
  "pending",
  "verifying",
  "verified",
  "degraded",
  "failed",
];

function boundedLimit(raw: string | undefined, fallback: number, max: number) {
  const requested = Number(raw ?? fallback);

  return Number.isFinite(requested) && requested > 0
    ? Math.min(requested, max)
    : fallback;
}

const registerSchema = z.object({
  externalId: z.string().min(1).max(MAX_EXTERNAL_ID_LENGTH).optional(),
  name: z.string().min(1).max(MAX_DOMAIN_LENGTH),
  profile: z.string().min(1).max(MAX_PROFILE_KEY_LENGTH),
});

/**
 * `lookups` is opt-in because the list endpoint is the size-sensitive path:
 * 389 bytes a domain without them, 1,728 with.
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

function serialise(domain: DomainRow, includeLookups = false) {
  const result = domain.lastResult;

  return {
    createdAt: domain.createdAt.toISOString(),
    externalId: domain.externalId,
    id: domain.id,
    lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null,
    // The derivation, on request. "Why did you say that" is the question a
    // disputed verdict produces, and a verdict alone cannot answer it.
    ...(includeLookups ? { lookups: result?.lookups ?? null } : {}),
    name: domain.name,
    object: "domain" as const,
    profileVersionId: domain.profileVersionId,
    // Null until the first check, and deliberately not an empty pass: a domain
    // nobody has looked at yet has no requirements met, not zero unmet.
    requirements: result === null ? null : result.requirements,
    requirementsMet:
      result === null
        ? null
        : result.requirements.filter((entry) => entry.satisfied).length,
    requirementsTotal: result === null ? null : result.requirements.length,
    state: domain.state,
    verdict: result === null ? null : result.verdict,
  };
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
  requirements: readonly RequirementResult[]
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

export function createDomainsRoute(options: {
  checkLimiter: RateLimiter;
  db: Database;
  resolver: ServerAddress;
}) {
  const route = new Hono<{ Variables: AuthVariables }>();
  const { db } = options;

  route.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return error(
        c,
        422,
        parsed.error.issues.at(0)?.message ?? "invalid request"
      );
    }

    const rejection = rejectDomain(parsed.data.name);

    if (rejection !== null) {
      return error(c, 422, rejection);
    }

    const tenantId = c.get("tenantId");
    const profile = await currentProfileVersion(
      db,
      tenantId,
      parsed.data.profile
    );

    if (profile === undefined) {
      // A domain must name a profile. Without one there is nothing to check it
      // against, and allowing the state would mean every later code path has to
      // handle a domain with no expectations.
      return error(c, 422, `no profile named "${parsed.data.profile}"`);
    }

    const outcome = await registerDomain(db, {
      ...(parsed.data.externalId === undefined
        ? {}
        : { externalId: parsed.data.externalId }),
      name: normaliseDomain(parsed.data.name),
      profileVersionId: profile.id,
      tenantId,
    });

    if (outcome.kind === "name-taken") {
      return error(
        c,
        409,
        `${normaliseDomain(parsed.data.name)} is already registered as ${outcome.existingId}`
      );
    }

    return success(c, serialise(outcome.domain), {
      // Re-sending an external id is what a partner's retry does. Saying which
      // happened lets them tell a retry from a second customer.
      created: outcome.kind === "created",
    });
  });

  route.post("/:id/checks", async (c) => {
    const tenantId = c.get("tenantId");
    const verdict = options.checkLimiter.take(tenantId);

    if (!verdict.allowed) {
      c.header("Retry-After", String(verdict.retryAfterSeconds));

      return error(
        c,
        429,
        `rate limit of ${options.checkLimiter.limit} checks per minute exceeded; try again in ${verdict.retryAfterSeconds}s`
      );
    }

    const domain = await domainById(db, tenantId, c.req.param("id"));

    if (domain === undefined) {
      return error(c, 404, "no such domain");
    }

    const profile = await profileVersionById(
      db,
      tenantId,
      domain.profileVersionId
    );

    if (profile === undefined) {
      // The reference does not cascade precisely so this cannot happen
      // silently. If it does, the domain cannot be evaluated and saying so is
      // the only honest answer.
      return error(
        c,
        500,
        `domain ${domain.id} is pinned to profile version ${domain.profileVersionId}, which no longer exists`
      );
    }

    const checked = await runChecks({
      domain: domain.name,
      profile: compileProfile(profile.definition, profile.id),
      resolver: {
        budgetMs: CHECK_BUDGET_MS,
        maxLookups: MAX_LOOKUPS,
        recursionDesired: true,
        target: options.resolver,
        timeoutMs: PER_QUERY_TIMEOUT_MS,
      },
    });

    const requirements = attributeResults(profile.definition, checked);
    const overall = overallVerdict(requirements);
    const now = new Date();
    const result: DomainResult = {
      checkedAt: now.toISOString(),
      lookups: storedLookups(checked),
      requirements,
      verdict: overall,
    };

    const state = nextState(domain.state, overall);

    await saveCheck(db, { domainId: domain.id, result, state, tenantId }, now);

    // An indeterminate check appends nothing at all. Recording the requirements
    // that did resolve would put half a picture on the timeline, taken while
    // the resolver was misbehaving.
    if (overall !== "indeterminate") {
      await recordChanges(db, domain.id, requirements);
    }

    return success(
      c,
      serialise(
        { ...domain, lastCheckedAt: now, lastResult: result, state },
        true
      ),
      { resolver: `${options.resolver.address}:${options.resolver.port}` }
    );
  });

  route.get("/", async (c) => {
    const state = c.req.query("state");

    if (state !== undefined && !DOMAIN_STATES.includes(state as DomainState)) {
      return error(
        c,
        422,
        `state must be one of ${DOMAIN_STATES.join(", ")}, got "${state}"`
      );
    }

    const page = await listDomains(db, c.get("tenantId"), {
      ...(c.req.query("cursor") === undefined
        ? {}
        : { cursor: c.req.query("cursor") as string }),
      ...(c.req.query("externalId") === undefined
        ? {}
        : { externalId: c.req.query("externalId") as string }),
      limit: boundedLimit(
        c.req.query("limit"),
        DEFAULT_PAGE_LIMIT,
        MAX_PAGE_LIMIT
      ),
      ...(state === undefined ? {} : { state: state as DomainState }),
    });

    return success(
      c,
      page.domains.map((domain) => serialise(domain)),
      { nextCursor: page.nextCursor }
    );
  });

  route.get("/:id", async (c) => {
    const domain = await domainById(db, c.get("tenantId"), c.req.param("id"));

    if (domain === undefined) {
      return error(c, 404, "no such domain");
    }

    return success(c, serialise(domain, true));
  });

  route.get("/:id/timeline", async (c) => {
    const domain = await domainById(db, c.get("tenantId"), c.req.param("id"));

    if (domain === undefined) {
      return error(c, 404, "no such domain");
    }

    const entries = await domainTimeline(
      db,
      domain.id,
      boundedLimit(
        c.req.query("limit"),
        DEFAULT_TIMELINE_LIMIT,
        MAX_TIMELINE_LIMIT
      )
    );

    return success(
      c,
      entries.map((entry) => ({
        current: entry.current,
        object: "record_change" as const,
        observedAt: entry.observedAt.toISOString(),
        previous: entry.previous,
        requirementKey: entry.requirementKey,
      }))
    );
  });

  route.delete("/:id", async (c) => {
    const removed = await deleteDomain(
      db,
      c.get("tenantId"),
      c.req.param("id")
    );

    if (!removed) {
      return error(c, 404, "no such domain");
    }

    // At tens of thousands of domains, with no way to stop tracking, the
    // sweeper in milestone 2 inherits every domain the partner ever had.
    return success(c, { deleted: true, id: c.req.param("id") });
  });

  return route;
}
