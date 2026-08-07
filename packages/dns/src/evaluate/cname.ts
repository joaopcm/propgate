import { DiagnosisCode } from "../diagnosis/codes";
import type { QueryOutcome } from "../transport/types";
import { RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
import { reportAnswerShape, reportTcpBlocked, reportTransport } from "./answer";
import type { EvaluationContext } from "./context";
import type { EvaluationResult } from "./types";

/**
 * An alias pointing at a target the platform issued.
 *
 * The record behind every custom subdomain: click tracking, a bounce host, a
 * customer-branded app domain. The customer publishes one CNAME at a name they
 * own and everything under it becomes ours to serve.
 *
 * Checking it is not "is there a CNAME here". Two providers make that question
 * return the wrong answer:
 *
 *  - **Flattening.** Cloudflare and a handful of others resolve the alias at
 *    edit time and serve address records in its place. The customer did exactly
 *    what they were told, `dig CNAME` returns nothing, and a checker that stops
 *    there reports a correctly configured domain as broken. So an absent CNAME
 *    sends us to the addresses, and we compare them against the addresses of the
 *    target we issued — which is the only way to tell a flattened alias from an
 *    A record pointed somewhere else entirely.
 *  - **Zone-name appending.** The same fault DKIM has, for the same reason: a
 *    provider that treats an absolute name as relative writes
 *    `track.example.com.example.com`. Probed for only when the alias found there
 *    points at *our* target, so a wildcard cannot trigger it.
 *
 * There is no weaker mode. Unlike SPF or DMARC, an alias with no expected target
 * is not a question worth asking — a CNAME is correct exactly when it points
 * where the platform said, and nothing about the record itself can be evaluated
 * without knowing that.
 */

const TRAILING_DOT = /\.$/;

export interface CnameCheck {
  /** The domain the customer is configuring, e.g. example.com. */
  readonly domain: string;
  /**
   * The label the alias goes at, e.g. `track`.
   *
   * Required, and not defaultable to the apex: RFC 1034 §3.6.2 forbids a CNAME
   * coexisting with the SOA and NS records every zone apex has, so an apex alias
   * is a record no customer can publish.
   */
  readonly label: string;
  /** The target we issued, e.g. `acme.track.propgate.com`. */
  readonly target: string;
}

export function cnameRecordName(check: CnameCheck): string {
  return `${check.label}.${check.domain}`;
}

function appendedRecordName(check: CnameCheck): string {
  return `${cnameRecordName(check)}.${check.domain}`;
}

/** DNS names fold case and may or may not be written absolute. */
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

/** The alias published at `name`, if one is. */
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
  readonly found: readonly string[];
  /**
   * Whether we got an answer at all.
   *
   * Distinct from an empty list. A name with no addresses is a fact about the
   * zone; a name we could not ask about is a fact about the network, and only
   * the first is evidence of anything.
   */
  readonly resolved: boolean;
}

/**
 * Every address at a name, of either family.
 *
 * AAAA is asked for only when A returns nothing, which keeps the common path at
 * one lookup. An IPv6-only target is unusual and legitimate, and reading a
 * missing A record as a missing address would fail it.
 */
async function addressesOf(
  context: EvaluationContext,
  name: string,
  purpose: string
): Promise<Addresses> {
  const fourth = await context.lookup({ name, purpose, type: RecordType.A });

  if (fourth.status !== "answered") {
    return { found: [], resolved: false };
  }

  const a = recordsOfType(fourth.message.answers, "A").map(
    (record) => record.rdata.address
  );

  if (a.length > 0) {
    return { found: a, resolved: true };
  }

  const sixth = await context.lookup({
    name,
    purpose: `${purpose}, over IPv6, since there is no A record`,
    type: RecordType.AAAA,
  });

  if (sixth.status !== "answered") {
    return { found: [], resolved: false };
  }

  return {
    found: recordsOfType(sixth.message.answers, "AAAA").map(
      (record) => record.rdata.address
    ),
    resolved: true,
  };
}

/**
 * Whether the token turns up at the doubled name a provider would have written.
 *
 * Guarded on the alias pointing at our target, for the same reason the ownership
 * probe is guarded on the token: a wildcard answers the doubled name too, and an
 * appended-zone-name finding raised by a wildcard sends someone to fix a record
 * they wrote correctly.
 */
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

/**
 * The flattening question: are the addresses here the target's addresses?
 *
 * Reached only when no CNAME is published and something else is. An overlap of
 * one is enough — a target behind several addresses can legitimately have been
 * flattened to any subset of them, and a provider that resolved the alias once
 * and cached the result will have exactly one.
 */
async function judgeAddresses(
  context: EvaluationContext,
  check: CnameCheck,
  name: string,
  observed: readonly string[]
): Promise<EvaluationResult["verdict"]> {
  const target = normalise(check.target);
  const expected = await addressesOf(
    context,
    target,
    `the addresses of ${target}, to tell a flattened alias from a wrong one`
  );

  // Our own target not resolving is our fault, not the customer's, and it is the
  // one state where we genuinely cannot judge what is published here.
  if (!expected.resolved || expected.found.length === 0) {
    return "indeterminate";
  }

  const shared = observed.filter((address) => expected.found.includes(address));

  if (shared.length > 0) {
    context.report(DiagnosisCode.PROVIDER_FLATTENED_CNAME, {
      detail:
        "the alias was resolved at edit time and stored as an address record, which is what this provider does to every CNAME; it points at us and it will not follow the target if the target's addresses change",
      expected: target,
      name,
      observed: shared.join(", "),
    });

    return "pass";
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

    /**
     * The appended-zone-name bug applied to the *target* rather than the owner.
     *
     * The same provider that treats an absolute owner name as relative does it
     * to the value too, and the two spellings it produces — our target with its
     * own zone appended, and our target with the customer's zone appended — both
     * read as "the target with something after it". Worth separating from an
     * ordinary mismatch because the remedy is not "point it somewhere else": the
     * customer pasted the right value and the provider changed it.
     */
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
    return finish(await judgeAddresses(context, check, name, observed.found));
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
