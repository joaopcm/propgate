import { DiagnosisCode } from "../diagnosis/codes";
import type { QueryOutcome } from "../transport/types";
import { RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
import { reportAnswerShape, reportTcpBlocked, reportTransport } from "./answer";
import type { EvaluationContext } from "./context";
import {
  type DkimRecord,
  isTestingMode,
  parseDkimKey,
  parseDkimRecord,
} from "./dkim-record";
import type { EvaluationResult, Verdict } from "./types";

export interface DkimCheck {
  readonly domain: string;
  readonly expectedPublicKey?: string;
  readonly selector: string;
  readonly wildcardSynthesised?: boolean;
}

const MINIMUM_KEY_BITS = 1024;

export function dkimRecordName(check: DkimCheck): string {
  return `${check.selector}._domainkey.${check.domain}`;
}

function appendedRecordName(check: DkimCheck): string {
  return `${dkimRecordName(check)}.${check.domain}`;
}

function txtValues(records: ReturnType<typeof recordsOfType<"TXT">>): string[] {
  return records.map((record) => record.rdata.value);
}

function looksLikeDkim(value: string): boolean {
  const lowered = value.toLowerCase();
  return lowered.includes("v=dkim1") || lowered.includes("p=");
}

async function findRecords(
  context: EvaluationContext,
  check: DkimCheck
): Promise<
  | {
      readonly kind: "found";
      readonly name: string;
      readonly outcome: QueryOutcome;
      readonly values: string[];
    }
  | { readonly kind: "appended"; readonly name: string }
  | { readonly kind: "absent"; readonly outcome: QueryOutcome }
  | {
      readonly kind: "indeterminate";
      readonly detail: string;
      readonly outcome: QueryOutcome;
    }
> {
  const name = dkimRecordName(check);
  const outcome = await context.lookup({
    name,
    purpose: "the expected DKIM selector",
    type: RecordType.TXT,
  });

  if (outcome.status === "answered") {
    const values = txtValues(
      recordsOfType(outcome.message.answers, "TXT")
    ).filter(looksLikeDkim);

    if (values.length > 0) {
      return { kind: "found", name, outcome, values };
    }
  }

  if (
    outcome.status === "timeout" ||
    outcome.status === "unreachable" ||
    outcome.status === "malformed" ||
    (outcome.status === "answered" && outcome.message.rcode === 2)
  ) {
    return {
      detail:
        outcome.status === "answered"
          ? "the nameserver returned SERVFAIL"
          : `the lookup ${outcome.status === "timeout" ? "timed out" : outcome.status}`,
      kind: "indeterminate",
      outcome,
    };
  }

  const doubled = appendedRecordName(check);
  const probe = await context.lookup({
    name: doubled,
    purpose: "probing for a provider that appended the zone name",
    type: RecordType.TXT,
  });

  if (probe.status === "answered" && probe.message.rcode === 0) {
    const values = txtValues(
      recordsOfType(probe.message.answers, "TXT")
    ).filter(looksLikeDkim);

    if (values.length > 0) {
      return { kind: "appended", name: doubled };
    }
  }

  return { kind: "absent", outcome };
}

function checkKey(
  context: EvaluationContext,
  check: DkimCheck,
  name: string,
  record: DkimRecord,
  raw: string
): Verdict {
  const key = parseDkimKey(record);

  if (!key.ok) {
    if (key.issue === "revoked") {
      context.report(DiagnosisCode.DKIM_KEY_REVOKED, {
        detail: key.detail,
        name,
        observed: raw,
      });
      return "fail";
    }

    context.report(DiagnosisCode.DKIM_KEY_UNPARSEABLE, {
      detail: key.detail,
      name,
      observed: raw,
    });

    reportRejoin(context, name, raw);

    return "fail";
  }

  let verdict: Verdict = "pass";

  if (key.type === "rsa" && key.bits < MINIMUM_KEY_BITS) {
    context.report(DiagnosisCode.DKIM_KEY_TOO_SHORT, {
      detail: `${key.bits}-bit key; 1024 is the floor and 2048 is recommended`,
      name,
    });
    verdict = "warn";
  }

  if (isTestingMode(record)) {
    context.report(DiagnosisCode.DKIM_TESTING_MODE, {
      detail: "t=y tells receivers to ignore signature failures",
      name,
      observed: raw,
    });
    verdict = "warn";
  }

  if (
    check.expectedPublicKey !== undefined &&
    record.publicKeyBase64 !== check.expectedPublicKey
  ) {
    context.report(DiagnosisCode.DKIM_KEY_MISMATCH, {
      detail:
        record.publicKeyBase64.toLowerCase() ===
        check.expectedPublicKey.toLowerCase()
          ? "the key differs only in letter case, but base64 is case-sensitive"
          : "a different key is published here",
      expected: check.expectedPublicKey,
      name,
      observed: record.publicKeyBase64,
    });
    return "fail";
  }

  return verdict;
}

function reportRejoin(
  context: EvaluationContext,
  name: string,
  raw: string
): void {
  if (raw.toLowerCase().split("v=dkim1").length - 1 < 2) {
    return;
  }

  context.report(DiagnosisCode.TXT_VALUE_SPLIT_MANGLED, {
    detail:
      "the record contains the v=DKIM1 prefix more than once, so each character-string was stored as a whole record rather than as a piece of one",
    name,
    observed: raw,
  });
}

export async function evaluateDkim(
  context: EvaluationContext,
  check: DkimCheck
): Promise<EvaluationResult> {
  const found = await findRecords(context, check);
  const name = dkimRecordName(check);

  if (found.kind === "indeterminate") {
    reportTcpBlocked(context, found.outcome, name);

    return {
      findings: context.findings,
      lookups: context.lookups,
      verdict: "indeterminate",
    };
  }

  if (found.kind === "appended") {
    context.report(DiagnosisCode.PROVIDER_APPENDED_ZONE_NAME, {
      detail:
        "your DNS provider added the domain to the end of the record name. Enter only the part before the domain.",
      expected: name,
      name,
      observed: found.name,
    });

    return {
      findings: context.findings,
      lookups: context.lookups,
      verdict: "fail",
    };
  }

  if (found.kind === "absent") {
    context.report(DiagnosisCode.DKIM_RECORD_MISSING, { name });
    reportAnswerShape(context, found.outcome, name);

    return {
      findings: context.findings,
      lookups: context.lookups,
      verdict: "fail",
    };
  }

  if (found.values.length > 1) {
    context.report(DiagnosisCode.MULTIPLE_DKIM_RECORDS, {
      detail:
        "receivers pick one unpredictably, so remove the ones that are not current",
      name,
      observed: `${found.values.length} records`,
    });

    return {
      findings: context.findings,
      lookups: context.lookups,
      verdict: "fail",
    };
  }

  reportTransport(context, found.outcome, found.name);

  const raw = found.values[0] ?? "";
  const parsed = parseDkimRecord(raw);

  if (check.wildcardSynthesised === true) {
    context.report(DiagnosisCode.WILDCARD_FALSE_POSITIVE, {
      detail:
        "this zone answers names nobody published, so a selector appearing to exist is not evidence that it was added — verify the value rather than its presence",
      name: found.name,
      observed: raw,
    });
  }

  if (!parsed.ok) {
    context.report(DiagnosisCode.DKIM_RECORD_MALFORMED, {
      detail: parsed.detail,
      name,
      observed: raw,
    });

    reportRejoin(context, name, raw);

    return {
      findings: context.findings,
      lookups: context.lookups,
      verdict: "fail",
    };
  }

  const verdict = checkKey(context, check, name, parsed.record, raw);

  return {
    findings: context.findings,
    lookups: context.lookups,
    verdict,
  };
}
