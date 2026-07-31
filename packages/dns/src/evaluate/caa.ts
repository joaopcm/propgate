import { DiagnosisCode } from "../diagnosis/codes";
import { RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
import type { RdataCAA } from "../wire/rdata";
import type { CaaPolicy } from "./caa-record";
import { decideIssuance, parseCaaPolicy } from "./caa-record";
import type { EvaluationContext } from "./context";
import type { EvaluationResult, Verdict } from "./types";

const TRAILING_DOT = /\.$/;
const RCODE_SERVFAIL = 2;
const RCODE_REFUSED = 5;

/**
 * CAA evaluation (RFC 8659).
 *
 * Three rules here are load-bearing, and each is easy to get wrong in a way that
 * either blocks issuance the owner allowed or permits issuance they forbade:
 *
 *  1. **The climb goes to the TLD, not to the organizational domain.** §3: "The
 *     search for a CAA RRset climbs the DNS name tree from the specified label
 *     up to, but not including, the DNS root." The Public Suffix List plays no
 *     part. A parent binding its children is the point — it is how a platform
 *     restricts which CAs may issue for names it hands out.
 *  2. **The nearest ancestor with a CAA RRset wins outright.** Policies are not
 *     merged up the tree. Merging would authorise CAs the nearer owner excluded.
 *  3. **`issuewild` governs wildcards exclusively when present.** Only when no
 *     `issuewild` exists do wildcards fall back to `issue`.
 */

export interface CaaCheck {
  readonly domain: string;
  /** The CA that needs to issue, e.g. "letsencrypt.org". */
  readonly issuer: string;
  /** Checking a wildcard certificate, which `issuewild` governs. */
  readonly wildcard?: boolean;
}

export interface CaaDiscovery {
  /** The name the RRset was found on, which may be an ancestor. */
  readonly foundAt: string;
  readonly policy: CaaPolicy;
  readonly records: readonly RdataCAA[];
}

/**
 * The names to try, nearest first, stopping before the root.
 *
 * `a.b.example.com` yields a.b.example.com, b.example.com, example.com, com —
 * and not the root.
 */
export function caaClimbPath(domain: string): string[] {
  const labels = domain.replace(TRAILING_DOT, "").split(".").filter(Boolean);
  const path: string[] = [];

  for (let i = 0; i < labels.length; i += 1) {
    path.push(labels.slice(i).join("."));
  }

  return path;
}

type ClimbOutcome =
  | { readonly kind: "found"; readonly discovery: CaaDiscovery }
  | { readonly kind: "none" }
  | { readonly kind: "indeterminate"; readonly at: string };

async function climb(
  context: EvaluationContext,
  domain: string
): Promise<ClimbOutcome> {
  for (const name of caaClimbPath(domain)) {
    // Deliberately sequential. The nearest ancestor with an RRset wins outright,
    // so every lookup past the first answer is one we must not make: it would
    // spend the shared lookup budget on names whose policies cannot apply.
    // biome-ignore lint/performance/noAwaitInLoops: the climb stops at the first answer
    const outcome = await context.lookup({
      name,
      purpose:
        name === domain
          ? "the domain's own CAA policy"
          : `climbing to ${name}, since no CAA policy was found below it`,
      type: RecordType.CAA,
    });

    if (
      outcome.status === "timeout" ||
      outcome.status === "unreachable" ||
      outcome.status === "malformed"
    ) {
      // A gap in the middle of the climb means we cannot know which policy
      // applies. Continuing would risk reporting a grandparent's policy as
      // governing when a nearer one exists and simply did not answer.
      return { at: name, kind: "indeterminate" };
    }

    if (outcome.status !== "answered") {
      return { at: name, kind: "indeterminate" };
    }

    // SERVFAIL and REFUSED both mean the server would not tell us. Treating
    // either as "no policy here" and climbing past it is the dangerous reading:
    // a policy may exist at this exact name, and assuming none would authorise
    // issuance the owner forbade. NXDOMAIN and NODATA are genuine absences and
    // do continue the climb.
    if (
      outcome.message.rcode === RCODE_SERVFAIL ||
      outcome.message.rcode === RCODE_REFUSED
    ) {
      return { at: name, kind: "indeterminate" };
    }

    const records = recordsOfType(outcome.message.answers, "CAA").map(
      (record) => record.rdata
    );

    // First non-empty RRset wins, and wins alone.
    if (records.length > 0) {
      return {
        discovery: { foundAt: name, policy: parseCaaPolicy(records), records },
        kind: "found",
      };
    }
  }

  return { kind: "none" };
}

export async function evaluateCaa(
  context: EvaluationContext,
  check: CaaCheck
): Promise<EvaluationResult> {
  const result = await climb(context, check.domain);

  const finish = (verdict: Verdict): EvaluationResult => ({
    findings: context.findings,
    lookups: context.lookups,
    verdict,
  });

  if (result.kind === "indeterminate") {
    return finish("indeterminate");
  }

  if (result.kind === "none") {
    // No policy is a legitimate, common configuration: it means any CA may
    // issue. Reporting it as a problem would be noise on most domains.
    context.report(DiagnosisCode.CAA_UNRESTRICTED, {
      detail: `no CAA record between ${check.domain} and the top-level domain, so ${check.issuer} may issue`,
      name: check.domain,
    });
    return finish("pass");
  }

  const { discovery } = result;

  if (discovery.foundAt !== check.domain) {
    context.report(DiagnosisCode.CAA_POLICY_FROM_ANCESTOR, {
      detail: `the policy governing this name is published on ${discovery.foundAt}; a record here would override it`,
      name: check.domain,
      observed: discovery.foundAt,
    });
  }

  const decision = decideIssuance(discovery.policy, check.issuer, {
    wildcard: check.wildcard,
  });

  if (decision.allowed) {
    return finish("pass");
  }

  if (decision.reason === "unknown-critical") {
    context.report(DiagnosisCode.CAA_CRITICAL_UNKNOWN_PROPERTY, {
      detail:
        "RFC 8659 §4.1 requires an authority that does not understand a critical property to refuse issuance, so this blocks every CA",
      name: discovery.foundAt,
      observed: discovery.policy.unknownCritical.join(", "),
    });
    return finish("fail");
  }

  // A wildcard blocked specifically by issuewild is worth its own code: ordinary
  // certificates still work, so "CAA is blocking us" would send someone looking
  // in the wrong place.
  const wildcardSpecific =
    check.wildcard === true && discovery.policy.issueWild.length > 0;

  if (decision.reason === "deny-all") {
    context.report(
      wildcardSpecific
        ? DiagnosisCode.CAA_WILDCARD_DENIED
        : DiagnosisCode.CAA_ISSUANCE_DENIED,
      {
        detail: wildcardSpecific
          ? "wildcard certificates are forbidden here, though ordinary ones are allowed"
          : "no certificate authority is permitted to issue for this name",
        name: discovery.foundAt,
        observed: wildcardSpecific ? 'issuewild ";"' : 'issue ";"',
      }
    );
    return finish("fail");
  }

  context.report(
    wildcardSpecific
      ? DiagnosisCode.CAA_WILDCARD_DENIED
      : DiagnosisCode.CAA_ISSUER_NOT_AUTHORIZED,
    {
      detail: `${check.issuer} is not listed${wildcardSpecific ? " for wildcards" : ""}; add it alongside the existing entries rather than replacing them`,
      expected: check.issuer,
      name: discovery.foundAt,
      observed: decision.permitted.join(", "),
    }
  );

  return finish("fail");
}
