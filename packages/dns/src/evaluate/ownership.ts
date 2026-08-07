import { DiagnosisCode } from "../diagnosis/codes";
import type { QueryOutcome } from "../transport/types";
import { RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
import { reportAnswerShape, reportTcpBlocked, reportTransport } from "./answer";
import type { EvaluationContext } from "./context";
import type { EvaluationResult } from "./types";

/**
 * An ownership token, published as TXT at a name the platform chose.
 *
 * The oldest check in this space and the only one with no RFC behind it: a
 * platform mints a string, the customer publishes it, and publishing it is the
 * proof they control the zone. Every other evaluator here asks whether a record
 * is *correct*; this one asks whether a specific value we issued is *there*.
 *
 * That difference is why exact comparison is not a stylistic choice. A token is
 * opaque — there is nothing in it to parse and no weaker question worth asking —
 * and comparing it byte-for-byte is what makes this check immune to the two
 * failure modes that make presence checks dangerous:
 *
 *  - **A wildcard cannot forge it.** `*.example.com TXT` makes every name answer,
 *    which is why DKIM has to probe for synthesis before trusting a selector's
 *    existence. A wildcard answering here still has to answer with the token,
 *    and only somebody holding the token can arrange that. No probe needed.
 *  - **A neighbouring record cannot satisfy it.** Apex TXT is a shared space —
 *    SPF, a Google site verification, three defunct tokens from vendors nobody
 *    uses any more. Requiring one value to match exactly, rather than requiring
 *    the name to have a record, is what keeps that crowd from counting.
 *
 * Missing and mismatched are separate codes because the remedies are opposite.
 * Nothing at the name means "add the record". Records at the name and none of
 * them ours usually means the token was pasted with something around it, and the
 * near-miss detail below is the whole reason this check deflects a ticket rather
 * than opening one.
 */

export interface OwnershipCheck {
  /** The domain the customer is configuring, e.g. example.com. */
  readonly domain: string;
  /**
   * The label the token goes at, e.g. `_pg-challenge`.
   *
   * Omit for the apex, which is where a good half of the industry puts it. An
   * apex token shares its name with SPF and with every other vendor's token, so
   * the exact match above is doing real work there.
   */
  readonly label?: string;
  /** The token we issued, compared byte-for-byte. */
  readonly token: string;
}

const WHITESPACE = /\s+/g;
const SURROUNDING_QUOTES = /^"([\s\S]*)"$/;

export function ownershipRecordName(check: OwnershipCheck): string {
  return check.label === undefined || check.label.length === 0
    ? check.domain
    : `${check.label}.${check.domain}`;
}

/**
 * The name a provider produces when it appends the zone to an already-absolute
 * name. Probing for it is what turns "record not found" into an instruction.
 */
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

/**
 * Why a published value is nearly the token, when one of them nearly is.
 *
 * Pure and exported so it can be unit-tested without a zone. Every case here is
 * a mistake somebody made with a token in hand, not a wrong token: the customer
 * did the work and a provider, or a copy-paste, spent it. Telling them apart
 * from "you pasted somebody else's token" is the difference between a support
 * reply that ends the thread and one that starts it.
 */
export interface TokenNearMiss {
  readonly detail: string;
  /**
   * Whether the value was corrupted in storage rather than mistyped.
   *
   * Only the chunk-rejoin case sets it, and it earns a second finding —
   * `TXT_VALUE_SPLIT_MANGLED` sends someone to their provider's record editor,
   * where the fault is, rather than back to the token we issued.
   */
  readonly mangled: boolean;
  readonly observed: string;
}

export function nearMissFor(
  token: string,
  values: readonly string[]
): TokenNearMiss | undefined {
  for (const value of values) {
    // A provider that stored the zone-file quoting as part of the value. The
    // record looks right in every UI that renders it unquoted, which is why this
    // one survives so long before anybody spots it.
    const unquoted = SURROUNDING_QUOTES.exec(value)?.[1];

    if (unquoted === token) {
      return {
        detail:
          "the surrounding quotes were stored as part of the value; enter the token without them",
        mangled: false,
        observed: value,
      };
    }

    // RFC 6763 §6.1 joins character-strings with no separator. A provider that
    // splits a long token and rejoins it with a space has changed the value,
    // and the record still looks correct at a glance.
    if (value !== token && value.replace(WHITESPACE, "") === token) {
      return {
        detail:
          "the value matches the token once whitespace is removed, so it was split into chunks and rejoined with a separator that is not part of it",
        mangled: true,
        observed: value,
      };
    }

    // Tokens are opaque, so case is content. DNS names fold case and values do
    // not, which is exactly the assumption that produces this.
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

/** Whether an outcome means "we could not tell" rather than "nothing is there". */
function isIndeterminate(outcome: QueryOutcome): boolean {
  return (
    outcome.status === "timeout" ||
    outcome.status === "unreachable" ||
    outcome.status === "malformed" ||
    (outcome.status === "answered" && outcome.message.rcode === 2)
  );
}

/**
 * Whether the token turns up at the doubled name a provider would have written.
 *
 * Guarded on the token rather than on the name answering at all, which is what
 * keeps it honest on a zone with a wildcard: a wildcard answers the doubled name
 * too, and reporting an appended zone name because of it would send someone to
 * fix a record they wrote correctly.
 */
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

    // Deliberately not a failure. A SERVFAIL says nothing about whether the
    // token is published, and a monitored domain that flips to failed on a
    // resolver blip pages somebody for nothing.
    return finish("indeterminate");
  }

  const values = txtValues(outcome);

  if (values.includes(check.token)) {
    // Working today, and one middlebox away from not working — worth saying even
    // when the token is exactly right.
    reportTransport(context, outcome, name);

    return finish("pass");
  }

  if (values.length > 0) {
    const near = nearMissFor(check.token, values);

    context.report(DiagnosisCode.OWNERSHIP_TOKEN_MISMATCH, {
      // With no near miss there is nothing to point at, so the evidence is what
      // *is* published. Listing it matters at the apex, where the answer is a
      // crowd of other vendors' records and "none of them the token" without the
      // crowd reads as though the name were empty.
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
