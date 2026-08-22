import { DiagnosisCode } from "../diagnosis/codes";
import type { QueryOutcome } from "../transport/types";
import { recordsOfType } from "../wire/message";
import type { EvaluationContext } from "./context";

const RCODE_NXDOMAIN = 3;

export function ttlsDisagree(
  records: readonly { readonly ttl: number }[]
): boolean {
  if (records.length < 2) {
    return false;
  }

  const [first] = records;

  return records.some((record) => record.ttl !== first?.ttl);
}

export function negativeCacheSeconds(
  outcome: QueryOutcome
): number | undefined {
  if (outcome.status !== "answered") {
    return;
  }

  const [soa] = recordsOfType(outcome.message.authority, "SOA");

  return soa === undefined ? undefined : Math.min(soa.rdata.minimum, soa.ttl);
}

const NEGATIVE_CACHE_WARN_SECONDS = 900;

export function reportTransport(
  context: EvaluationContext,
  outcome: QueryOutcome,
  name: string
): void {
  if (outcome.transport !== "tcp") {
    return;
  }

  context.report(DiagnosisCode.TRUNCATED_FELL_BACK_TO_TCP, {
    detail:
      "the answer did not fit in a UDP packet, so it was fetched over TCP; that works, and it stops working behind a middlebox that blocks TCP port 53",
    name,
  });
}

export function reportTcpBlocked(
  context: EvaluationContext,
  outcome: QueryOutcome,
  name: string
): void {
  if (outcome.status !== "timeout" || !outcome.retriedOverTcp) {
    return;
  }

  context.report(DiagnosisCode.TCP_SILENTLY_BLOCKED, {
    detail:
      "this server answered over UDP and asked us to retry over TCP because the answer was too large, then the TCP connection produced nothing at all — which is what a middlebox blocking TCP port 53 looks like, and it means large records here never arrive",
    expected: "an answer over TCP, as the truncated UDP reply invited",
    name,
    observed: `no response within ${outcome.timeoutMs}ms over TCP`,
  });
}

export function reportTtlDisagreement(
  context: EvaluationContext,
  records: readonly { readonly ttl: number }[],
  name: string
): void {
  if (!ttlsDisagree(records)) {
    return;
  }

  context.report(DiagnosisCode.RRSET_TTL_MISMATCH, {
    detail:
      "RFC 2181 §5.2 requires every record in a set to share a TTL; part of this one will expire before the rest, so the answer changes shape with nothing having been edited",
    name,
    observed: [...new Set(records.map((record) => record.ttl))]
      .sort((a, b) => a - b)
      .map((ttl) => `${ttl}s`)
      .join(", "),
  });
}

export function reportAnswerShape(
  context: EvaluationContext,
  outcome: QueryOutcome,
  name: string
): void {
  reportTransport(context, outcome, name);

  if (outcome.status !== "answered") {
    return;
  }

  if (outcome.message.rcode !== RCODE_NXDOMAIN) {
    context.report(DiagnosisCode.NODATA_NOT_NXDOMAIN, {
      detail:
        "the name exists and carries other records, so this is a record published at the wrong name or as the wrong type rather than one that was never added",
      name,
    });
  }

  const seconds = negativeCacheSeconds(outcome);

  if (seconds !== undefined && seconds > NEGATIVE_CACHE_WARN_SECONDS) {
    context.report(DiagnosisCode.NEGATIVE_CACHE_LIKELY, {
      detail: `resolvers may remember this absence for ${seconds} seconds after the record is added, so a correct fix will not appear to work until then`,
      name,
      observed: `${seconds}s`,
    });
  }
}
