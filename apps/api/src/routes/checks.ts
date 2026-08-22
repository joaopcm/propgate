import type {
  CheckKind,
  CheckResult,
  DomainProfile,
  Finding,
  ServerAddress,
} from "@propgate/dns";
import { CHECK_KINDS, DIAGNOSIS_REGISTRY, runChecks } from "@propgate/dns";
import { Hono } from "hono";
import { z } from "zod";
import {
  MAX_DOMAIN_LENGTH,
  normaliseDomain,
  rejectDomain,
} from "../utils/domain-name";
import type { RateLimiter } from "../utils/rate-limit";
import { error, success } from "../utils/response";
import { firstIssue } from "../utils/validation";

export const CHECKS_PER_MINUTE = 20;
export const RATE_LIMIT_WINDOW_MS = 60_000;

const CHECK_BUDGET_MS = 10_000;
const PER_QUERY_TIMEOUT_MS = 3000;
const MAX_LOOKUPS = 100;

const MAX_RECORDS = 5;
const MAX_TOKEN_LENGTH = 255;

const requestSchema = z.object({
  caaIssuer: z.string().min(1).max(MAX_DOMAIN_LENGTH).optional(),
  checks: z.array(z.enum(CHECK_KINDS)).min(1).optional(),
  cnames: z
    .array(
      z.object({
        label: z.string().min(1).max(MAX_DOMAIN_LENGTH),
        target: z.string().min(1).max(MAX_DOMAIN_LENGTH),
      })
    )
    .max(MAX_RECORDS)
    .optional(),
  dkimSelectors: z.array(z.string().min(1).max(63)).max(10).optional(),
  domain: z.string().min(1).max(MAX_DOMAIN_LENGTH),
  expectsMail: z.boolean().optional(),
  ownership: z
    .array(
      z.object({
        label: z.string().min(1).max(MAX_DOMAIN_LENGTH).optional(),
        token: z.string().min(1).max(MAX_TOKEN_LENGTH),
      })
    )
    .max(MAX_RECORDS)
    .optional(),
  spfInclude: z.string().min(1).max(MAX_DOMAIN_LENGTH).optional(),
  spfIp: z.string().min(1).max(45).optional(),
});

function profileFrom(input: z.infer<typeof requestSchema>): DomainProfile {
  return {
    checks: (input.checks ?? [...CHECK_KINDS]) as readonly CheckKind[],
    id: "request",
    ...(input.expectsMail === undefined
      ? {}
      : { mx: [{ expectsMail: input.expectsMail }] }),
    ...(input.caaIssuer === undefined ? {} : { caaIssuer: input.caaIssuer }),
    ...(input.cnames === undefined ? {} : { cnames: input.cnames }),
    ...(input.dkimSelectors === undefined
      ? {}
      : { dkimSelectors: input.dkimSelectors }),
    ...(input.ownership === undefined ? {} : { ownership: input.ownership }),
    ...(input.spfInclude === undefined && input.spfIp === undefined
      ? {}
      : {
          spf: [
            {
              ...(input.spfInclude === undefined
                ? {}
                : { include: input.spfInclude }),
              ...(input.spfIp === undefined ? {} : { ip: input.spfIp }),
            },
          ],
        }),
  };
}

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
      return error(c, 422, firstIssue(parsed.error));
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
