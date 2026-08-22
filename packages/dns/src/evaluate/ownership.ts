import { DiagnosisCode } from "../diagnosis/codes";
import type { QueryOutcome } from "../transport/types";
import { RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
import { reportAnswerShape, reportTcpBlocked, reportTransport } from "./answer";
import type { EvaluationContext } from "./context";
import type { EvaluationResult } from "./types";

export interface OwnershipCheck {
  readonly domain: string;
  readonly label?: string;
  readonly token: string;
}

const WHITESPACE = /\s+/g;
const SURROUNDING_QUOTES = /^"([\s\S]*)"$/;

export function ownershipRecordName(check: OwnershipCheck): string {
  return check.label === undefined || check.label.length === 0
    ? check.domain
    : `${check.label}.${check.domain}`;
}

function appendedRecordName(check: OwnershipCheck): string {
  return `${ownershipRecordName(check)}.${check.domain}`;
}

function txtValues(outcome: QueryOutcome): string[] {
  return outcome.status === "answered"
    ? recordsOfType(outcome.message.answers, "TXT").map(
        (record) => record.rdata.value
      )
    : [];
}

export interface TokenNearMiss {
  readonly detail: string;
  readonly mangled: boolean;
  readonly observed: string;
}

export function nearMissFor(
  token: string,
  values: readonly string[]
): TokenNearMiss | undefined {
  for (const value of values) {
    const unquoted = SURROUNDING_QUOTES.exec(value)?.[1];

    if (unquoted === token) {
      return {
        detail:
          "the surrounding quotes were stored as part of the value; enter the token without them",
        mangled: false,
        observed: value,
      };
    }

    if (value !== token && value.replace(WHITESPACE, "") === token) {
      return {
        detail:
          "the value matches the token once whitespace is removed, so it was split into chunks and rejoined with a separator that is not part of it",
        mangled: true,
        observed: value,
      };
    }

    if (value !== token && value.toLowerCase() === token.toLowerCase()) {
      return {
        detail:
          "the value differs from the token only in letter case, and a token is compared exactly",
        mangled: false,
        observed: value,
      };
    }

    if (value.length > 0 && value !== token && token.startsWith(value)) {
      return {
        detail: `only the first ${value.length} of the token's ${token.length} characters were published, so the value was truncated`,
        mangled: false,
        observed: value,
      };
    }
  }
}

function isIndeterminate(outcome: QueryOutcome): boolean {
  return (
    outcome.status === "timeout" ||
    outcome.status === "unreachable" ||
    outcome.status === "malformed" ||
    (outcome.status === "answered" && outcome.message.rcode === 2)
  );
}

async function probeAppended(
  context: EvaluationContext,
  check: OwnershipCheck
): Promise<boolean> {
  const outcome = await context.lookup({
    name: appendedRecordName(check),
    purpose: "probing for a provider that appended the zone name",
    type: RecordType.TXT,
  });

  return txtValues(outcome).includes(check.token);
}

export async function evaluateOwnership(
  context: EvaluationContext,
  check: OwnershipCheck
): Promise<EvaluationResult> {
  const name = ownershipRecordName(check);

  const outcome = await context.lookup({
    name,
    purpose: "the ownership token we issued",
    type: RecordType.TXT,
  });

  const finish = (verdict: EvaluationResult["verdict"]): EvaluationResult => ({
    findings: context.findings,
    lookups: context.lookups,
    verdict,
  });

  if (isIndeterminate(outcome)) {
    reportTcpBlocked(context, outcome, name);

    return finish("indeterminate");
  }

  const values = txtValues(outcome);

  if (values.includes(check.token)) {
    reportTransport(context, outcome, name);

    return finish("pass");
  }

  if (values.length > 0) {
    const near = nearMissFor(check.token, values);

    context.report(DiagnosisCode.OWNERSHIP_TOKEN_MISMATCH, {
      detail:
        near === undefined
          ? `${values.length} text record${values.length === 1 ? "" : "s"} at this name, none of them the token`
          : near.detail,
      expected: check.token,
      name,
      observed: near === undefined ? values.join(" | ") : near.observed,
    });

    if (near?.mangled) {
      context.report(DiagnosisCode.TXT_VALUE_SPLIT_MANGLED, {
        detail: near.detail,
        name,
        observed: near.observed,
      });
    }

    return finish("fail");
  }

  if (await probeAppended(context, check)) {
    context.report(DiagnosisCode.PROVIDER_APPENDED_ZONE_NAME, {
      detail:
        "your DNS provider added the domain to the end of the record name. Enter only the part before the domain.",
      expected: name,
      name,
      observed: appendedRecordName(check),
    });

    return finish("fail");
  }

  context.report(DiagnosisCode.OWNERSHIP_TOKEN_MISSING, {
    expected: check.token,
    name,
  });
  reportAnswerShape(context, outcome, name);

  return finish("fail");
}
