import { DiagnosisCode } from "../diagnosis/codes";
import { RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
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
  | { readonly kind: "found"; readonly values: string[]; readonly name: string }
  | { readonly kind: "appended"; readonly name: string }
  | { readonly kind: "absent" }
  | { readonly kind: "indeterminate"; readonly detail: string }
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
      return { kind: "found", name, values };
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

  return { kind: "absent" };
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

    // A mangled value is also evidence about *how* it broke, which is a
    // separate, more actionable finding than "the key is unreadable".
    if (key.issue === "malformed-base64" && key.detail.includes("space")) {
      context.report(DiagnosisCode.TXT_VALUE_SPLIT_MANGLED, {
        detail:
          "the base64 key contains whitespace, which a correct split never produces",
        name,
        observed: raw,
      });
    }

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
export async function evaluateDkim(
  context: EvaluationContext,
  check: DkimCheck
): Promise<EvaluationResult> {
  const found = await findRecords(context, check);
  const name = dkimRecordName(check);

  if (found.kind === "indeterminate") {
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

  const raw = found.values[0] ?? "";
  const parsed = parseDkimRecord(raw);

  if (!parsed.ok) {
    context.report(DiagnosisCode.DKIM_RECORD_MALFORMED, {
      detail: parsed.detail,
      name,
      observed: raw,
    });

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
