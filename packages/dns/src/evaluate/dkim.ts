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

/**
 * DKIM selector evaluation.
 *
 * The job is not "is there a TXT record" — it is "will a receiver be able to
 * verify a signature made with this selector, and if not, what should the
 * customer change". Those differ in every interesting case.
 */

export interface DkimCheck {
  /** The domain the customer is configuring, e.g. example.com. */
  readonly domain: string;
  /**
   * The base64 key we issued, when there is one.
   *
   * Omit for a generic health check. Supplying it is what turns "a valid key is
   * published" into "the *right* key is published", which is the difference
   * between passing a domain that copied a competitor's record and catching it.
   */
  readonly expectedPublicKey?: string;
  /** The selector, e.g. "resend" — the label before _domainkey. */
  readonly selector: string;
  /**
   * Whether the zone answers for names nobody published.
   *
   * Passed in rather than probed here: it is a fact about the zone, and DKIM is
   * the check most likely to run several times over one domain. Probing per
   * selector would ask the same question three times.
   */
  readonly wildcardSynthesised?: boolean;
}

/** Below this, receivers have started refusing keys outright. */
const MINIMUM_KEY_BITS = 1024;

export function dkimRecordName(check: DkimCheck): string {
  return `${check.selector}._domainkey.${check.domain}`;
}

/**
 * The name a provider produces when it appends the zone to an already-absolute
 * name. Probing for it is what turns "record not found" into an instruction.
 */
function appendedRecordName(check: DkimCheck): string {
  return `${dkimRecordName(check)}.${check.domain}`;
}

function txtValues(records: ReturnType<typeof recordsOfType<"TXT">>): string[] {
  return records.map((record) => record.rdata.value);
}

/**
 * DKIM records are identified by content, not just by name.
 *
 * A selector can legitimately carry unrelated TXT records — verification tokens
 * end up there surprisingly often. Filtering to the ones that look like DKIM
 * avoids reporting MULTIPLE_DKIM_RECORDS for a domain that has one DKIM record
 * and one Google site verification.
 */
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
  // The outcome travels with the absence: the *shape* of the nothing that came
  // back is as actionable as the nothing. See `reportAnswerShape`.
  | { readonly kind: "absent"; readonly outcome: QueryOutcome }
  // The outcome travels here too, for the same reason it travels with `absent`:
  // "we could not tell" has shapes, and one of them — a swallowed TCP retry — is
  // specific enough to name.
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

  // A timeout, a refusal, or a SERVFAIL means we could not tell. Probing for a
  // mangled name would be guessing, and reporting "missing" would be a lie.
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

  // Nothing at the right name. Before calling it missing, check the single most
  // common provider mistake: the zone name appended to an absolute name.
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

  // Byte-exact. DNS names fold case; base64 does not, so a key differing only in
  // case is a different key and must not be treated as a match.
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

/**
 * Evaluate one DKIM selector.
 *
 * Returns the verdict, the findings with their evidence, and every lookup made
 * with the reason it happened. Callers render the derivation; they should not
 * have to re-run anything to explain the result.
 */
/**
 * A record whose chunks were rejoined with the tag prefix repeated.
 *
 * The signature is a second `v=DKIM1` inside what should be one tag-value list:
 * the provider emitted the whole prefix on every character-string instead of
 * splitting the base64. Worth its own finding, because "duplicate tag k=" sends
 * someone to look at their key when the fault is in how it was stored.
 *
 * Whitespace at a chunk boundary is *not* this. RFC 6376 §2.10 permits folding
 * whitespace inside base64, and reporting it here told people a working key was
 * broken.
 */
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
    // Why we could not tell, when the reason is nameable. The verdict stays
    // `indeterminate` — a blocked retry means the key may well be published and
    // simply unreachable at this size, so calling it broken would be a guess —
    // but a finding turns "we could not tell" into something actionable.
    reportTcpBlocked(context, found.outcome, name);

    // Deliberately not a failure. See the Verdict docs: "we could not tell" and
    // "it is broken" must never collapse into one another.
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

  // Working today, and one middlebox away from not working — worth saying even
  // when the record itself is perfect.
  reportTransport(context, found.outcome, found.name);

  const raw = found.values[0] ?? "";
  const parsed = parseDkimRecord(raw);

  if (check.wildcardSynthesised === true) {
    // Reported here rather than the moment the record was found: a wildcard
    // alongside a genuinely published selector is not a false positive. It is
    // one only when the answer we are about to trust could have been
    // synthesised, which is exactly now.
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

    // A repeated prefix trips the duplicate-tag check first, and "duplicate tag
    // k=" sends someone to look at their key when the fault is in how the
    // provider stored it.
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
