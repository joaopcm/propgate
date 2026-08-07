import type {
  Database,
  DomainListRow,
  DomainRow,
  DomainState,
  ProfileVersion,
} from "@propgate/db";
import {
  currentProfileVersion,
  deleteDomain,
  domainById,
  domainTimeline,
  listDomains,
  profileVersionById,
  registerDomain,
  updateDomainConfig,
} from "@propgate/db";
import type { ServerAddress } from "@propgate/dns";
import type { DeliverWebhookPayload } from "@propgate/jobs";
import type { Queue } from "bullmq";
import { Hono } from "hono";
import { z } from "zod";
import { checkAndPersist } from "../domains/check";
import type { HysteresisThresholds } from "../domains/hysteresis";
import type { AuthVariables } from "../middleware/auth";
import {
  rejectExpectations,
  rejectUnsatisfiedExpectations,
} from "../profiles/expectations";
import {
  MAX_DOMAIN_LENGTH,
  normaliseDomain,
  rejectDomain,
} from "../utils/domain-name";
import type { RateLimiter } from "../utils/rate-limit";
import { error, success } from "../utils/response";
import { firstIssue } from "../utils/validation";
import { enqueueForTransition } from "../webhooks/enqueue";

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
 * So 100 checks a minute is up to ~1,900 upstream queries a minute — roughly 33
 * a second — aimed at whatever authoritative servers the *caller* names. That
 * last part is why this number is the one that matters and why it came down from
 * 600 when signup opened: a self-serve tenant is otherwise a way to point our
 * resolver at somebody else's infrastructure, which is exactly what open DNS
 * tooling gets used for. Thirty-three queries a second at servers we do not own
 * is defensible for a caller nobody has spoken to.
 *
 * It stays generous for what the endpoint is actually for — a customer clicking
 * "verify" during onboarding. Bulk re-verification is the sweeper's job, and has
 * been since milestone 2; it does not come through here and is not limited by
 * this.
 */
export const CHECKS_PER_TENANT_PER_MINUTE = 100;
export const CHECK_RATE_LIMIT_WINDOW_MS = 60_000;

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

/**
 * The same bound a profile's literal `expectedPublicKey` gets.
 *
 * A 2048-bit RSA key is about 400 characters of base64 and a 4096-bit one about
 * 800, so this is a tripwire rather than a limit: it sits past anything a real
 * key reaches, and only a value that is not a key can touch it.
 */
const MAX_EXPECTATION_VALUE_LENGTH = 4096;

const expectationsSchema = z.record(
  z.string().min(1).max(MAX_PROFILE_KEY_LENGTH),
  z.record(
    z.string().min(1),
    z.string().min(1).max(MAX_EXPECTATION_VALUE_LENGTH)
  )
);

const registerSchema = z.object({
  /**
   * The values for whatever the profile requires per domain.
   *
   * Keyed by requirement key, then by field. Which keys and fields are legal
   * cannot be expressed here: it depends on the profile this domain is being
   * registered against, which is fetched after the body is parsed. See
   * `rejectExpectations`.
   */
  expectations: expectationsSchema.optional(),
  externalId: z.string().min(1).max(MAX_EXTERNAL_ID_LENGTH).optional(),
  name: z.string().min(1).max(MAX_DOMAIN_LENGTH),
  profile: z.string().min(1).max(MAX_PROFILE_KEY_LENGTH),
});

/**
 * Changing what a domain is judged against.
 *
 * Both fields are optional and at least one is required, because a PATCH that
 * changes nothing would still reset the domain to `pending` and re-verify it —
 * a no-op request with a side effect.
 */
const updateSchema = z
  .object({
    expectations: expectationsSchema.optional(),
    profile: z.string().min(1).max(MAX_PROFILE_KEY_LENGTH).optional(),
  })
  .refine(
    (body) => body.expectations !== undefined || body.profile !== undefined,
    { message: "supply expectations, profile, or both" }
  );

function serialise(domain: DomainListRow, includeLookups = false) {
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
 * One domain, with the fields the list deliberately omits.
 *
 * `expectations` is off the list because a page of two hundred domains was sized
 * at 389 bytes each and one DKIM key would roughly double that for a field the
 * list does not render. On a single domain it is the cheapest rotation-debugging
 * tool there is, and a public key is not a secret.
 *
 * `expectationsFingerprint` comes from the stored result rather than from the row,
 * because it describes what the *last check* compared — which is the question
 * worth asking after a rotation: has anything looked at the new value yet?
 */
function serialiseDetail(domain: DomainRow, includeLookups = false) {
  return {
    ...serialise(domain, includeLookups),
    expectations: domain.expectations ?? null,
    expectationsFingerprint: domain.lastResult?.expectationsFingerprint ?? null,
  };
}

export function createDomainsRoute(options: {
  checkLimiter: RateLimiter;
  db: Database;
  resolver: ServerAddress;
  resolvers: readonly ServerAddress[];
  thresholds?: HysteresisThresholds;
  webhooks?: Queue<DeliverWebhookPayload>;
}) {
  const route = new Hono<{ Variables: AuthVariables }>();
  const { db } = options;

  route.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return error(c, 422, firstIssue(parsed.error));
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

    /**
     * Now that the profile is known, whether these values fit it is decidable.
     *
     * Refused here rather than discovered at the first sweep: a domain whose
     * profile requires a DKIM key it never received is one that can only ever
     * report `indeterminate`, and finding that out from a dashboard days later is
     * strictly worse than finding out from this response.
     */
    const unsatisfied = rejectExpectations(
      parsed.data.profile,
      profile.definition,
      parsed.data.expectations ?? null
    );

    if (unsatisfied !== null) {
      return error(c, 422, unsatisfied);
    }

    const outcome = await registerDomain(db, {
      ...(parsed.data.expectations === undefined
        ? {}
        : { expectations: parsed.data.expectations }),
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

    return success(c, serialiseDetail(outcome.domain), {
      // Re-sending an external id is what a partner's retry does. Saying which
      // happened lets them tell a retry from a second customer. It also means
      // `created: false` is the signal that any expectations in this request were
      // *not* applied — rotating a value is PATCH, not a second POST.
      created: outcome.kind === "created",
    });
  });

  /**
   * Change a domain's values, its profile, or both.
   *
   * This route is what makes per-domain expectations usable rather than
   * write-once. A platform rotating a DKIM key has to be able to tell us the new
   * one, and the obvious alternative — re-POSTing with the same `externalId` —
   * answers 200 having written nothing, because that path is deliberately
   * idempotent. A success response for a no-op, with the sweeper still comparing
   * the old key, is the worst of the available failures.
   *
   * Re-pointing to another profile is the same operation and shares the code path.
   * A tenant moving a customer from `sending-only` to `full-mail` and a tenant
   * rotating a key are both saying "judge this domain against something else now",
   * and both invalidate the previous verdict in the same way.
   */
  route.patch("/:id", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return error(c, 422, firstIssue(parsed.error));
    }

    const tenantId = c.get("tenantId");
    const domain = await domainById(db, tenantId, c.req.param("id"));

    if (domain === undefined) {
      return error(c, 404, "no such domain");
    }

    let profile: ProfileVersion | undefined;

    if (parsed.data.profile === undefined) {
      profile = await profileVersionById(db, tenantId, domain.profileVersionId);

      if (profile === undefined) {
        // The reference does not cascade precisely so this cannot happen
        // silently. Same answer as the verify route gives.
        return error(
          c,
          500,
          `domain ${domain.id} is pinned to profile version ${domain.profileVersionId}, which no longer exists`
        );
      }
    } else {
      profile = await currentProfileVersion(db, tenantId, parsed.data.profile);

      if (profile === undefined) {
        return error(c, 422, `no profile named "${parsed.data.profile}"`);
      }
    }

    /**
     * Validated against the effective pair, not the submitted one.
     *
     * A re-point that leaves a required field unsupplied has to fail here, with
     * the domain untouched. Writing it and letting the next sweep discover the
     * gap would turn a fixable 422 into a domain stuck at `indeterminate` — and
     * `pending`, so it would look like it was merely still being verified.
     *
     * Which check depends on where the values came from. Anything submitted gets
     * the strict one, so a mistyped key is caught while the caller is still
     * looking. Values only carried forward get the lenient one: a domain
     * re-pointed at another profile keeps the keys its previous one asked for, and
     * those are legitimately unknown to the new definition rather than a mistake.
     *
     * Stale keys are retained rather than pruned. The merge already ignores
     * anything the profile did not ask for, and pruning would make re-pointing
     * lossy: going back would mean re-sending values we already had.
     */
    const effective =
      parsed.data.expectations === undefined
        ? domain.expectations
        : parsed.data.expectations;
    const unsatisfied =
      parsed.data.expectations === undefined
        ? rejectUnsatisfiedExpectations(
            profile.key,
            profile.definition,
            effective
          )
        : rejectExpectations(profile.key, profile.definition, effective);

    if (unsatisfied !== null) {
      return error(c, 422, unsatisfied);
    }

    const updated = await updateDomainConfig(db, tenantId, domain.id, {
      ...(parsed.data.expectations === undefined
        ? {}
        : { expectations: parsed.data.expectations }),
      ...(parsed.data.profile === undefined
        ? {}
        : { profileVersionId: profile.id }),
    });

    if (updated === undefined) {
      // Deleted between the read and the write.
      return error(c, 404, "no such domain");
    }

    /**
     * No webhook, and no transition row.
     *
     * The domain going back to `pending` is not news about the customer's DNS —
     * it is news about us, and they are the ones who just told us. `pending` is
     * not an event any webhook fires on, so this needs no suppression beyond not
     * inventing one.
     */
    return success(c, serialiseDetail(updated), {
      profileVersionId: profile.id,
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

    // The sweeper calls this same function. Anything added here that is not in
    // it is a way for the two to disagree about one domain.
    const checkedOrStale = await checkAndPersist(db, {
      // `DomainRow` omits `tenantId` because every query that returns one is
      // already tenant-scoped. The sweeper has no request to scope it by, so the
      // shared function takes it explicitly.
      domain: { ...domain, tenantId },
      profile: { definition: profile.definition, id: profile.id },
      settings: {
        resolvers: options.resolvers,
        ...(options.thresholds === undefined
          ? {}
          : { thresholds: options.thresholds }),
      },
    });

    /**
     * The configuration changed while this check ran, so its answer was discarded.
     *
     * Re-read and return the row as it now stands — `pending`, against the values
     * the caller just wrote. Reporting the computed verdict instead would be this
     * endpoint claiming a state for a configuration nothing has checked, which is
     * the thing the compare-and-set in `saveCheck` refused to store. `meta` says
     * so rather than leaving it to be inferred from a state that looks stale.
     */
    if (checkedOrStale === null) {
      const current = await domainById(db, tenantId, domain.id);

      return success(
        c,
        current === undefined
          ? serialiseDetail(domain, true)
          : serialiseDetail(current, true),
        { superseded: true }
      );
    }

    const checked = checkedOrStale;

    // The same notification path the sweeper uses. A domain that flips because a
    // customer clicked verify is exactly as newsworthy as one that flips on its
    // own, and having only one of the two notify would be indistinguishable from
    // a bug.
    if (checked.transition !== null) {
      await enqueueForTransition(
        {
          db,
          ...(options.webhooks === undefined
            ? {}
            : { queue: options.webhooks }),
        },
        {
          domain: domain.name,
          domainId: domain.id,
          externalId: domain.externalId,
          from: checked.transition.from,
          reason: checked.transition.reason,
          tenantId,
          to: checked.transition.to,
        }
      );
    }

    return success(
      c,
      serialiseDetail(
        {
          ...domain,
          lastCheckedAt: checked.checkedAt,
          lastResult: checked.result,
          nextCheckAt: checked.nextCheckAt,
          state: checked.state,
        },
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

    return success(c, serialiseDetail(domain, true));
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
