import type {
  CheckKind,
  CheckResult,
  DomainProfile,
  Finding,
  ServerAddress,
} from "@propgate/dns";
import {
  CHECK_KINDS,
  DIAGNOSIS_REGISTRY,
  getPublicSuffix,
  runChecks,
} from "@propgate/dns";
import { Hono } from "hono";
import { z } from "zod";
import type { RateLimiter } from "../utils/rate-limit";
import { error, success } from "../utils/response";

/**
 * `POST /v1/checks` — everything propgate knows about one domain.
 *
 * The interactive surface. It is deliberately request-driven and stateless:
 * nothing is stored, nothing is scheduled, and the sweeper that will run these
 * continuously in Phase 2 shares the evaluators rather than this route.
 */

/**
 * Receipts for the numbers below, measured against the fixture tier:
 *
 *  - A healthy sending-only domain costs **10 lookups** and returns in **23 ms**.
 *  - A domain sitting near SPF's ten-lookup limit costs **19** and returns in
 *    **25 ms**.
 *
 * So 20 checks a minute from one client is at most ~400 upstream queries a
 * minute — generous for a human, who does perhaps one every ten seconds, and
 * an obstacle only to a script. A good widget never touches it. If a real
 * caller does, the number is wrong and should be re-measured rather than
 * worked around.
 */
export const CHECKS_PER_MINUTE = 20;
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Past what any real check needs. Six checks run concurrently, not in series. */
const CHECK_BUDGET_MS = 10_000;
const PER_QUERY_TIMEOUT_MS = 3000;
/** A backstop against a pathological zone, not a limit any evaluator enforces. */
const MAX_LOOKUPS = 100;

const MAX_DOMAIN_LENGTH = 253;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const TRAILING_DOT = /\.$/;

/** One spelling of a name, so validation and evaluation cannot disagree. */
function normaliseDomain(domain: string): string {
  return domain.trim().replace(TRAILING_DOT, "").toLowerCase();
}

const requestSchema = z.object({
  caaIssuer: z.string().min(1).max(MAX_DOMAIN_LENGTH).optional(),
  checks: z.array(z.enum(CHECK_KINDS)).min(1).optional(),
  dkimSelectors: z.array(z.string().min(1).max(63)).max(10).optional(),
  domain: z.string().min(1).max(MAX_DOMAIN_LENGTH),
  expectsMail: z.boolean().optional(),
  spfInclude: z.string().min(1).max(MAX_DOMAIN_LENGTH).optional(),
  spfIp: z.string().min(1).max(45).optional(),
});

/**
 * Why a name cannot be checked, or null.
 *
 * Zod covers the shape; this covers the two things about a domain name that a
 * schema cannot express — that every label is well formed, and that the name is
 * not itself a public suffix. Checking `com` is not a question with an answer,
 * and running six evaluators against it would produce a confident, meaningless
 * report.
 */
export function rejectDomain(domain: string): string | null {
  const name = normaliseDomain(domain);

  if (name.length === 0 || name.length > MAX_DOMAIN_LENGTH) {
    return "domain must be between 1 and 253 characters";
  }

  const labels = name.split(".");

  if (labels.length < 2) {
    return "domain must have at least two labels, as in example.com";
  }

  if (!labels.every((label) => LABEL.test(label))) {
    return `"${domain}" is not a valid domain name`;
  }

  if (getPublicSuffix(name) === name) {
    return `"${name}" is a public suffix, not a domain anyone can configure`;
  }

  return null;
}

function profileFrom(input: z.infer<typeof requestSchema>): DomainProfile {
  return {
    // Everything the caller gave an expectation for, and delegation always.
    checks: (input.checks ?? [...CHECK_KINDS]) as readonly CheckKind[],
    id: "request",
    // Deliberately not defaulted. A caller who did not say has not asserted
    // that the domain receives mail, and inventing the assertion here would
    // report every sending-only domain as broken.
    ...(input.expectsMail === undefined
      ? {}
      : { expectsMail: input.expectsMail }),
    ...(input.caaIssuer === undefined ? {} : { caaIssuer: input.caaIssuer }),
    ...(input.dkimSelectors === undefined
      ? {}
      : { dkimSelectors: input.dkimSelectors }),
    ...(input.spfInclude === undefined ? {} : { spfInclude: input.spfInclude }),
    ...(input.spfIp === undefined ? {} : { spfIp: input.spfIp }),
  };
}

/**
 * Findings, with the taxonomy folded in.
 *
 * A code alone makes the consumer ship a copy of the registry and keep it in
 * step with ours. The summary and the slug travel with the finding so a
 * dashboard can render something a human reads, and link to the docs page for
 * it, without knowing anything about propgate's taxonomy.
 */
function describe(finding: Finding) {
  const definition = DIAGNOSIS_REGISTRY[finding.code];

  return {
    code: finding.code,
    evidence: finding.evidence,
    severity: finding.severity,
    slug: definition.slug,
    summary: definition.summary,
  };
}

function serialise(result: CheckResult, elapsedMs: number) {
  return {
    checks: result.checks.map((check) => ({
      findings: check.findings.map(describe),
      kind: check.kind,
      // The lookups are the derivation. Kept per check rather than flattened,
      // because "why did you say that" is asked about one check at a time.
      lookups: check.lookups.map((lookup) => ({
        name: lookup.name,
        purpose: lookup.purpose,
        server: `${lookup.server.address}:${lookup.server.port}`,
        status: lookup.outcome.status,
        type: lookup.type,
      })),
      verdict: check.verdict,
    })),
    domain: result.domain,
    elapsedMs,
    findings: result.findings.map(describe),
    object: "check" as const,
    verdict: result.verdict,
  };
}

/** The client address, for rate limiting only. */
function clientKey(forwarded: string | undefined): string {
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export function createChecksRoute(options: {
  limiter: RateLimiter;
  resolver: ServerAddress;
}) {
  const route = new Hono();

  route.post("/", async (c) => {
    const verdict = options.limiter.take(
      clientKey(c.req.header("x-forwarded-for"))
    );

    if (!verdict.allowed) {
      c.header("Retry-After", String(verdict.retryAfterSeconds));
      return error(
        c,
        429,
        `too many checks; try again in ${verdict.retryAfterSeconds}s`
      );
    }

    const body = await c.req.json().catch(() => null);
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      // The first issue is the one a caller can act on. `.at` rather than an
      // index because `noUncheckedIndexedAccess` is on and Zod's types do not
      // promise the array is non-empty.
      const issue = parsed.error.issues.at(0);

      return error(c, 422, issue?.message ?? "invalid request");
    }

    const rejection = rejectDomain(parsed.data.domain);

    if (rejection !== null) {
      return error(c, 422, rejection);
    }

    const startedAt = Date.now();
    const result = await runChecks({
      domain: normaliseDomain(parsed.data.domain),
      profile: profileFrom(parsed.data),
      resolver: {
        budgetMs: CHECK_BUDGET_MS,
        maxLookups: MAX_LOOKUPS,
        recursionDesired: true,
        target: options.resolver,
        timeoutMs: PER_QUERY_TIMEOUT_MS,
      },
    });

    return success(c, serialise(result, Date.now() - startedAt), {
      resolver: `${options.resolver.address}:${options.resolver.port}`,
    });
  });

  return route;
}
