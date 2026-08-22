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

export const CHECKS_PER_TENANT_PER_MINUTE = 100;
export const CHECK_RATE_LIMIT_WINDOW_MS = 60_000;

const MAX_EXTERNAL_ID_LENGTH = 255;
const MAX_PROFILE_KEY_LENGTH = 64;
const DEFAULT_TIMELINE_LIMIT = 50;
const MAX_TIMELINE_LIMIT = 200;

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

const MAX_EXPECTATION_VALUE_LENGTH = 4096;

const expectationsSchema = z.record(
  z.string().min(1).max(MAX_PROFILE_KEY_LENGTH),
  z.record(
    z.string().min(1),
    z.string().min(1).max(MAX_EXPECTATION_VALUE_LENGTH)
  )
);

const registerSchema = z.object({
  expectations: expectationsSchema.optional(),
  externalId: z.string().min(1).max(MAX_EXTERNAL_ID_LENGTH).optional(),
  name: z.string().min(1).max(MAX_DOMAIN_LENGTH),
  profile: z.string().min(1).max(MAX_PROFILE_KEY_LENGTH),
});

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
    ...(includeLookups ? { lookups: result?.lookups ?? null } : {}),
    name: domain.name,
    object: "domain" as const,
    profileVersionId: domain.profileVersionId,
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
      return error(c, 422, `no profile named "${parsed.data.profile}"`);
    }

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
      created: outcome.kind === "created",
    });
  });

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
      return error(c, 404, "no such domain");
    }

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
      return error(
        c,
        500,
        `domain ${domain.id} is pinned to profile version ${domain.profileVersionId}, which no longer exists`
      );
    }

    const checkedOrStale = await checkAndPersist(db, {
      domain: { ...domain, tenantId },
      profile: { definition: profile.definition, id: profile.id },
      settings: {
        resolvers: options.resolvers,
        ...(options.thresholds === undefined
          ? {}
          : { thresholds: options.thresholds }),
      },
    });

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

    return success(c, { deleted: true, id: c.req.param("id") });
  });

  return route;
}
