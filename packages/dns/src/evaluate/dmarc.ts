import { DiagnosisCode } from "../diagnosis/codes";
import { getRegistrableDomain } from "../psl";
import { RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
import type { EvaluationContext } from "./context";
import {
  type DmarcRecord,
  type DmarcReportUri,
  effectivePolicy,
  looksLikeDmarc,
  parseDmarcRecord,
} from "./dmarc-record";
import type { EvaluationResult, Verdict } from "./types";
import { worstVerdict } from "./types";

/**
 * DMARC policy evaluation.
 *
 * Two things here are routinely implemented backwards, and both are the whole
 * value of the check:
 *
 *  1. **Discovery order.** RFC 7489 §6.6.3 queries the *exact* name first. The
 *     organizational domain is a fallback, used only when the exact name has no
 *     record — and `sp=` governs subdomains only in that fallback case. An
 *     earlier comment in this repo had it the other way round.
 *  2. **External report authorization.** A `rua=` pointing at another
 *     organizational domain requires that domain to publish
 *     `<source>._report._dmarc.<destination>`. Almost nobody implements the
 *     check, so reports are addressed and then silently discarded — the domain
 *     owner sees no reports and no error.
 */

export interface DmarcCheck {
  /**
   * Verify that external report destinations have authorised this domain.
   *
   * Defaults to true. Costs one lookup per distinct external destination.
   */
  readonly checkExternalReports?: boolean;
  /** The domain being checked, which may be a subdomain. */
  readonly domain: string;
}

export interface DmarcDiscovery {
  readonly foundAt: "exact" | "organizational";
  /** The DNS name the record was read from. */
  readonly name: string;
  readonly raw: string;
  readonly record: DmarcRecord;
}

export function dmarcRecordName(domain: string): string {
  return `_dmarc.${domain}`;
}

type DiscoveryOutcome =
  | { readonly kind: "found"; readonly discovery: DmarcDiscovery }
  | { readonly kind: "absent" }
  | { readonly kind: "multiple"; readonly name: string; readonly count: number }
  | {
      readonly kind: "malformed";
      readonly name: string;
      readonly raw: string;
      readonly detail: string;
    }
  | { readonly kind: "indeterminate" };

async function readPolicyAt(
  context: EvaluationContext,
  domain: string,
  purpose: string
): Promise<
  | { readonly kind: "none" }
  | { readonly kind: "indeterminate" }
  | { readonly kind: "multiple"; readonly count: number }
  | { readonly kind: "one"; readonly raw: string }
> {
  const name = dmarcRecordName(domain);
  const outcome = await context.lookup({
    name,
    purpose,
    type: RecordType.TXT,
  });

  if (
    outcome.status === "timeout" ||
    outcome.status === "unreachable" ||
    outcome.status === "malformed"
  ) {
    return { kind: "indeterminate" };
  }

  if (outcome.status !== "answered") {
    return { kind: "indeterminate" };
  }

  if (outcome.message.rcode === 2) {
    return { kind: "indeterminate" };
  }

  // RFC 7489 §6.6.3 discards non-DMARC records *before* counting, so a domain
  // with one policy and one unrelated TXT has a policy rather than an ambiguity.
  const candidates = recordsOfType(outcome.message.answers, "TXT")
    .map((record) => record.rdata.value)
    .filter(looksLikeDmarc);

  if (candidates.length === 0) {
    return { kind: "none" };
  }

  if (candidates.length > 1) {
    return { count: candidates.length, kind: "multiple" };
  }

  return { kind: "one", raw: candidates[0] ?? "" };
}

async function discover(
  context: EvaluationContext,
  check: DmarcCheck
): Promise<DiscoveryOutcome> {
  const exact = await readPolicyAt(
    context,
    check.domain,
    "the domain's own DMARC policy"
  );

  if (exact.kind === "indeterminate") {
    return { kind: "indeterminate" };
  }

  if (exact.kind === "multiple") {
    return {
      count: exact.count,
      kind: "multiple",
      name: dmarcRecordName(check.domain),
    };
  }

  if (exact.kind === "one") {
    const parsed = parseDmarcRecord(exact.raw);

    if (!parsed.ok) {
      return {
        detail: parsed.detail,
        kind: "malformed",
        name: dmarcRecordName(check.domain),
        raw: exact.raw,
      };
    }

    return {
      discovery: {
        foundAt: "exact",
        name: dmarcRecordName(check.domain),
        raw: exact.raw,
        record: parsed.record,
      },
      kind: "found",
    };
  }

  // Nothing at the exact name. Fall back to the organizational domain — and
  // only to there. Climbing further would read a policy belonging to nobody.
  const organizational = getRegistrableDomain(check.domain);

  if (organizational === null || organizational === check.domain) {
    return { kind: "absent" };
  }

  const fallback = await readPolicyAt(
    context,
    organizational,
    "the organizational domain's policy, since the domain publishes none"
  );

  if (fallback.kind === "indeterminate") {
    return { kind: "indeterminate" };
  }

  if (fallback.kind === "multiple") {
    return {
      count: fallback.count,
      kind: "multiple",
      name: dmarcRecordName(organizational),
    };
  }

  if (fallback.kind === "none") {
    return { kind: "absent" };
  }

  const parsed = parseDmarcRecord(fallback.raw);

  if (!parsed.ok) {
    return {
      detail: parsed.detail,
      kind: "malformed",
      name: dmarcRecordName(organizational),
      raw: fallback.raw,
    };
  }

  return {
    discovery: {
      foundAt: "organizational",
      name: dmarcRecordName(organizational),
      raw: fallback.raw,
      record: parsed.record,
    },
    kind: "found",
  };
}

/** `<source>._report._dmarc.<destination>` — RFC 7489 §7.1. */
function authorizationName(source: string, destination: string): string {
  return `${source}._report._dmarc.${destination}`;
}

function reportDestination(uri: DmarcReportUri): string | null {
  if (uri.scheme !== "mailto") {
    return null;
  }

  const at = uri.target.lastIndexOf("@");

  if (at === -1 || at === uri.target.length - 1) {
    return null;
  }

  return uri.target.slice(at + 1).toLowerCase();
}

async function checkExternalReports(
  context: EvaluationContext,
  domain: string,
  discovery: DmarcDiscovery
): Promise<Verdict> {
  const source = getRegistrableDomain(domain) ?? domain;
  const uris = [
    ...discovery.record.aggregateReportUris,
    ...discovery.record.forensicReportUris,
  ];

  const external = new Set<string>();
  let verdict: Verdict = "pass";

  for (const uri of uris) {
    const destination = reportDestination(uri);

    if (destination === null) {
      context.report(DiagnosisCode.DMARC_REPORT_URI_INVALID, {
        detail:
          uri.scheme === ""
            ? "no URI scheme; DMARC report addresses must look like mailto:someone@example.com"
            : `${uri.scheme}: is not a scheme receivers send reports to`,
        name: discovery.name,
        observed: uri.raw,
      });
      verdict = "warn";
      continue;
    }

    // Same organizational domain needs no authorization.
    if ((getRegistrableDomain(destination) ?? destination) !== source) {
      external.add(destination);
    }
  }

  // Destinations are independent of one another, so query them together rather
  // than paying a round trip each. The evaluation budget is a tripwire at 50,
  // not a tight limit, so concurrent reads cannot meaningfully race it — unlike
  // SPF, whose limit of 10 is exact and will have to sequence its lookups.
  const checks = await Promise.all(
    [...external].map(async (destination) => {
      const name = authorizationName(source, destination);

      return {
        destination,
        name,
        outcome: await context.lookup({
          name,
          purpose: `whether ${destination} has authorised receiving reports for ${source}`,
          type: RecordType.TXT,
        }),
      };
    })
  );

  for (const { destination, name, outcome } of checks) {
    if (outcome.status !== "answered") {
      // Could not tell. Not evidence of misconfiguration.
      continue;
    }

    const authorized = recordsOfType(outcome.message.answers, "TXT").some(
      (record) => looksLikeDmarc(record.rdata.value)
    );

    if (!authorized) {
      context.report(DiagnosisCode.DMARC_EXTERNAL_REPORT_UNAUTHORIZED, {
        detail: `${destination} has not authorised receiving DMARC reports for ${source}, so those reports are discarded without any error`,
        expected: `a TXT record at ${name} containing v=DMARC1`,
        name,
      });
      verdict = "fail";
    }
  }

  return verdict;
}

export async function evaluateDmarc(
  context: EvaluationContext,
  check: DmarcCheck
): Promise<EvaluationResult> {
  const found = await discover(context, check);

  const finish = (verdict: Verdict): EvaluationResult => ({
    findings: context.findings,
    lookups: context.lookups,
    verdict,
  });

  if (found.kind === "indeterminate") {
    return finish("indeterminate");
  }

  if (found.kind === "absent") {
    context.report(DiagnosisCode.DMARC_RECORD_MISSING, {
      name: dmarcRecordName(check.domain),
    });
    return finish("fail");
  }

  if (found.kind === "multiple") {
    context.report(DiagnosisCode.DMARC_MULTIPLE_RECORDS, {
      detail:
        "RFC 7489 treats more than one policy as no policy at all, so nothing is enforced today",
      name: found.name,
      observed: `${found.count} records`,
    });
    return finish("fail");
  }

  if (found.kind === "malformed") {
    context.report(DiagnosisCode.DMARC_RECORD_MALFORMED, {
      detail: found.detail,
      name: found.name,
      observed: found.raw,
    });
    return finish("fail");
  }

  const { discovery } = found;
  const policy = effectivePolicy(discovery.record, discovery.foundAt);
  const verdicts: Verdict[] = ["pass"];

  if (discovery.foundAt === "organizational") {
    context.report(DiagnosisCode.DMARC_POLICY_INHERITED, {
      detail: discovery.record.subdomainPolicy
        ? `sp=${discovery.record.subdomainPolicy} at ${discovery.name} governs this subdomain`
        : `p=${discovery.record.policy ?? "none"} at ${discovery.name} governs this subdomain, since no sp= is set`,
      name: discovery.name,
    });
  }

  // A record at the org domain must carry p=. At a subdomain it may be omitted,
  // in which case there is nothing to enforce and the record does no work.
  if (policy === undefined) {
    context.report(DiagnosisCode.DMARC_RECORD_MALFORMED, {
      detail: "no p= tag, so the record states no policy",
      name: discovery.name,
      observed: discovery.raw,
    });
    return finish("fail");
  }

  if (policy === "none") {
    context.report(DiagnosisCode.DMARC_POLICY_NONE, {
      detail:
        "failing messages are still delivered; move to quarantine once reports look clean",
      name: discovery.name,
      observed: `p=${policy}`,
    });
    verdicts.push("warn");
  }

  if (discovery.record.percent < 100) {
    context.report(DiagnosisCode.DMARC_POLICY_PARTIAL, {
      detail: `the policy applies to ${discovery.record.percent}% of failing messages; the rest are delivered`,
      name: discovery.name,
      observed: `pct=${discovery.record.percent}`,
    });
    verdicts.push("warn");
  }

  if (check.checkExternalReports !== false) {
    verdicts.push(await checkExternalReports(context, check.domain, discovery));
  }

  return finish(worstVerdict(verdicts));
}
