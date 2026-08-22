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

export interface CaaCheck {
  readonly domain: string;
  readonly issuer: string;
  readonly wildcard?: boolean;
}

export interface CaaDiscovery {
  readonly foundAt: string;
  readonly policy: CaaPolicy;
  readonly records: readonly RdataCAA[];
}

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
      return { at: name, kind: "indeterminate" };
    }

    if (outcome.status !== "answered") {
      return { at: name, kind: "indeterminate" };
    }

    if (
      outcome.message.rcode === RCODE_SERVFAIL ||
      outcome.message.rcode === RCODE_REFUSED
    ) {
      return { at: name, kind: "indeterminate" };
    }

    const records = recordsOfType(outcome.message.answers, "CAA").map(
      (record) => record.rdata
    );

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
