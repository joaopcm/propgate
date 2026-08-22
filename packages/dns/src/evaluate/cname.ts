import { DiagnosisCode } from "../diagnosis/codes";
import type { QueryOutcome } from "../transport/types";
import { RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
import { reportAnswerShape, reportTcpBlocked, reportTransport } from "./answer";
import type { EvaluationContext } from "./context";
import type { EvaluationResult } from "./types";

const TRAILING_DOT = /\.$/;

export interface CnameCheck {
  readonly domain: string;
  readonly label: string;
  readonly target: string;
}

export function cnameRecordName(check: CnameCheck): string {
  return `${check.label}.${check.domain}`;
}

function appendedRecordName(check: CnameCheck): string {
  return `${cnameRecordName(check)}.${check.domain}`;
}

function normalise(name: string): string {
  return name.trim().replace(TRAILING_DOT, "").toLowerCase();
}

function isIndeterminate(outcome: QueryOutcome): boolean {
  return (
    outcome.status === "timeout" ||
    outcome.status === "unreachable" ||
    outcome.status === "malformed" ||
    (outcome.status === "answered" && outcome.message.rcode === 2)
  );
}

function aliasIn(outcome: QueryOutcome, name: string): string | undefined {
  if (outcome.status !== "answered") {
    return;
  }

  const record = recordsOfType(outcome.message.answers, "CNAME").find(
    (candidate) => normalise(candidate.name) === normalise(name)
  );

  return record === undefined ? undefined : normalise(record.rdata.target);
}

interface Addresses {
  readonly complete: boolean;
  readonly found: readonly string[];
}

async function addressesOf(
  context: EvaluationContext,
  name: string,
  purpose: string
): Promise<Addresses> {
  const [fourth, sixth] = await Promise.all([
    context.lookup({ name, purpose, type: RecordType.A }),
    context.lookup({
      name,
      purpose: `${purpose}, over IPv6`,
      type: RecordType.AAAA,
    }),
  ]);

  const found = [
    ...(fourth.status === "answered"
      ? recordsOfType(fourth.message.answers, "A").map(
          (record) => record.rdata.address
        )
      : []),
    ...(sixth.status === "answered"
      ? recordsOfType(sixth.message.answers, "AAAA").map(
          (record) => record.rdata.address
        )
      : []),
  ];

  return {
    complete: fourth.status === "answered" && sixth.status === "answered",
    found,
  };
}

async function probeAppended(
  context: EvaluationContext,
  check: CnameCheck
): Promise<boolean> {
  const doubled = appendedRecordName(check);

  const outcome = await context.lookup({
    name: doubled,
    purpose: "probing for a provider that appended the zone name",
    type: RecordType.CNAME,
  });

  return aliasIn(outcome, doubled) === normalise(check.target);
}

async function judgeAddresses(
  context: EvaluationContext,
  check: CnameCheck,
  name: string,
  published: Addresses
): Promise<EvaluationResult["verdict"]> {
  const target = normalise(check.target);
  const expected = await addressesOf(
    context,
    target,
    `the addresses of ${target}, to tell a flattened alias from a wrong one`
  );

  if (!expected.complete || expected.found.length === 0) {
    return "indeterminate";
  }

  const observed = published.found;
  const shared = observed.filter((address) => expected.found.includes(address));
  const strangers = observed.filter(
    (address) => !expected.found.includes(address)
  );

  if (strangers.length === 0 && !published.complete) {
    return "indeterminate";
  }

  if (shared.length > 0 && strangers.length === 0) {
    context.report(DiagnosisCode.PROVIDER_FLATTENED_CNAME, {
      detail:
        "the alias was resolved at edit time and stored as an address record, which is what this provider does to every CNAME; it points at us and it will not follow the target if the target's addresses change",
      expected: target,
      name,
      observed: shared.join(", "),
    });

    return "pass";
  }

  if (shared.length > 0) {
    context.report(DiagnosisCode.CNAME_TARGET_PARTIAL, {
      detail: `${shared.length} of the ${observed.length} addresses here are ${target}'s and ${strangers.length} ${strangers.length === 1 ? "is" : "are"} not; clients pick from the whole set, so requests for this name are split between us and somewhere else — usually a record from a previous provider that was added to rather than replaced`,
      expected: target,
      name,
      observed: strangers.join(", "),
    });

    return "fail";
  }

  context.report(DiagnosisCode.CNAME_TARGET_MISMATCH, {
    detail: `an address record here instead of an alias, and it is not an address of ${target} — so this is a record pointed somewhere else rather than a provider that flattened ours`,
    expected: target,
    name,
    observed: observed.join(", "),
  });

  return "fail";
}

export async function evaluateCname(
  context: EvaluationContext,
  check: CnameCheck
): Promise<EvaluationResult> {
  const name = cnameRecordName(check);
  const target = normalise(check.target);

  const outcome = await context.lookup({
    name,
    purpose: `the alias to ${target}`,
    type: RecordType.CNAME,
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

  const alias = aliasIn(outcome, name);

  if (alias !== undefined) {
    if (alias === target) {
      reportTransport(context, outcome, name);

      return finish("pass");
    }

    if (alias.startsWith(`${target}.`)) {
      context.report(DiagnosisCode.PROVIDER_APPENDED_ZONE_NAME, {
        detail:
          "the target we issued is here with a domain appended to it. Your DNS provider treated an absolute name as a relative one — enter the target with a trailing dot, if the provider allows it.",
        expected: target,
        name,
        observed: alias,
      });

      return finish("fail");
    }

    context.report(DiagnosisCode.CNAME_TARGET_MISMATCH, {
      detail:
        "an alias is published here and it points somewhere else, so traffic for this name does not reach us",
      expected: target,
      name,
      observed: alias,
    });

    return finish("fail");
  }

  const observed = await addressesOf(
    context,
    name,
    "whether a provider flattened the alias into address records"
  );

  if (observed.found.length > 0) {
    return finish(await judgeAddresses(context, check, name, observed));
  }

  if (!observed.complete) {
    return finish("indeterminate");
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

  context.report(DiagnosisCode.CNAME_RECORD_MISSING, {
    detail: `nothing is published at this name, so requests for it never reach ${target}`,
    expected: target,
    name,
  });
  reportAnswerShape(context, outcome, name);

  return finish("fail");
}
