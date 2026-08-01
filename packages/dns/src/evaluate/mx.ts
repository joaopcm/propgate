import { isIPv4, isIPv6 } from "node:net";
import { DiagnosisCode } from "../diagnosis/codes";
import { RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
import type { EvaluationContext } from "./context";
import type { EvaluationResult, Verdict } from "./types";
import { verdictFromFindings, worstVerdict } from "./types";

/**
 * Mail routing (RFC 5321 §5.1, RFC 7505, RFC 2181 §10.3).
 *
 * The load-bearing idea here is that **the same records are correct or broken
 * depending on what the domain is for**. A null MX on a sending-only domain is
 * the right answer, published deliberately, and reporting it as a fault trains
 * people to ignore the report. The same record on a domain that expects mail
 * means every message bounces.
 *
 * So the observations and the judgement are separate codes. `MX_NULL` says what
 * is published and is always informational; `MX_MAIL_NOT_ACCEPTED` says the
 * domain wanted mail and cannot receive it, and only appears when that is true.
 * Severity is fixed per code — it has to be, because consumers switch on it —
 * so a finding whose seriousness depends on intent has to be two findings.
 */

const RCODE_NXDOMAIN = 3;
const TRAILING_DOT = /\.$/;

/** RFC 7505: preference 0, exchange the root. */
const NULL_MX_PREFERENCE = 0;

export interface MxCheck {
  readonly domain: string;
  /**
   * Whether this domain is meant to receive mail.
   *
   * Three states, not two: `true`, `false`, and *not stated*. Undeliverable
   * mail is only a fault if someone said the domain should receive it, and a
   * caller who did not say — the public checker, a CLI run with no flags — has
   * not asserted anything. Defaulting either way puts words in their mouth,
   * and defaulting to `true` in particular reports every correctly configured
   * sending-only domain as broken.
   */
  readonly expectsMail?: boolean;
}

interface Exchange {
  readonly host: string;
  readonly preference: number;
}

function normalise(name: string): string {
  return name.trim().replace(TRAILING_DOT, "").toLowerCase();
}

/** RFC 7505 §3: preference 0 and an exchange of "." — the root name. */
function isNullMx(exchange: Exchange): boolean {
  return exchange.preference === NULL_MX_PREFERENCE && exchange.host === "";
}

async function readExchanges(
  context: EvaluationContext,
  domain: string
): Promise<readonly Exchange[] | undefined> {
  const outcome = await context.lookup({
    name: domain,
    purpose: `where mail for ${domain} is delivered`,
    type: RecordType.MX,
  });

  if (outcome.status !== "answered") {
    return;
  }

  if (outcome.message.rcode !== 0 && outcome.message.rcode !== RCODE_NXDOMAIN) {
    return;
  }

  return recordsOfType(outcome.message.answers, "MX").map((record) => ({
    host: normalise(record.rdata.exchange),
    preference: record.rdata.preference,
  }));
}

/**
 * Whether the domain has an address of its own.
 *
 * RFC 5321 §5.1: with no MX, senders fall back to the address record and treat
 * the domain itself as the mail exchange. It works, and it is almost never what
 * anyone intended.
 */
async function hasAddress(
  context: EvaluationContext,
  domain: string
): Promise<boolean> {
  const outcome = await context.lookup({
    name: domain,
    purpose: `whether ${domain} is its own mail exchange, since it publishes no MX`,
    type: RecordType.A,
  });

  return (
    outcome.status === "answered" &&
    recordsOfType(outcome.message.answers, "A").length > 0
  );
}

/** Whether mail could actually reach this exchange. */
async function checkExchange(
  context: EvaluationContext,
  domain: string,
  exchange: Exchange
): Promise<boolean> {
  // The MX rdata field is a domain name. An address written there is read as a
  // name, so it resolves to nothing and mail silently stops — a zone file will
  // happily accept it and dig will happily print it.
  if (isIPv4(exchange.host) || isIPv6(exchange.host)) {
    context.report(DiagnosisCode.MX_TARGET_IS_IP_LITERAL, {
      detail:
        "the MX field holds a domain name, so an address written here is looked up as a name and resolves to nothing",
      name: domain,
      observed: exchange.host,
    });
    return false;
  }

  const outcome = await context.lookup({
    name: exchange.host,
    purpose: `an address for the mail exchange ${exchange.host}`,
    type: RecordType.A,
  });

  if (outcome.status !== "answered") {
    // Could not tell. Not evidence that the exchange is unreachable.
    return true;
  }

  const isCname = recordsOfType(outcome.message.answers, "CNAME").some(
    (record) => normalise(record.name) === exchange.host
  );

  if (isCname) {
    context.report(DiagnosisCode.MX_TARGET_IS_CNAME, {
      detail:
        "RFC 2181 §10.3 forbids it; most senders follow the alias anyway, which is exactly why the ones that refuse look like an intermittent fault",
      name: domain,
      observed: exchange.host,
    });
  }

  if (recordsOfType(outcome.message.answers, "A").length > 0) {
    return true;
  }

  // An IPv6-only exchange is unusual and legitimate, so the absence of an A
  // record is not on its own an absence of an address.
  const sixth = await context.lookup({
    name: exchange.host,
    purpose: `an IPv6 address for ${exchange.host}, which has no A record`,
    type: RecordType.AAAA,
  });

  if (
    sixth.status === "answered" &&
    recordsOfType(sixth.message.answers, "AAAA").length > 0
  ) {
    return true;
  }

  context.report(DiagnosisCode.MX_TARGET_UNRESOLVABLE, {
    detail:
      "the exchange has no address of either family, so senders have nowhere to connect and mail to this domain bounces",
    name: domain,
    observed: exchange.host,
  });

  return false;
}

/**
 * Findings about a null MX, which is a statement rather than a fault.
 *
 * Returns whether mail can be delivered at all.
 */
function reportNullMx(
  context: EvaluationContext,
  domain: string,
  exchanges: readonly Exchange[]
): boolean {
  // The detail has to add to the summary rather than restate it: rendered
  // together in the CLI and the checker, two sentences saying the same thing
  // read as padding and teach people to skip both.
  context.report(DiagnosisCode.MX_NULL, {
    detail:
      "senders that honour RFC 7505 reject immediately instead of retrying for days, which is the reason to publish it rather than simply having no MX",
    name: domain,
    observed: "0 .",
  });

  const others = exchanges.filter((exchange) => !isNullMx(exchange));

  if (others.length > 0) {
    // §3 requires the null MX to be the only one. Senders disagree about what
    // to do with the pair, so delivery depends on whose MTA is trying.
    context.report(DiagnosisCode.MX_NULL_WITH_OTHER_RECORDS, {
      detail:
        "RFC 7505 §3 requires a null MX to be the only MX; senders disagree about what this pair means, so whether a message is delivered depends on whose mail server is trying",
      expected: "either a null MX alone, or ordinary exchanges alone",
      name: domain,
      observed: others.map((exchange) => exchange.host).join(", "),
    });
  }

  return false;
}

async function reportNoMx(
  context: EvaluationContext,
  domain: string
): Promise<boolean> {
  context.report(DiagnosisCode.MX_RECORDS_MISSING, {
    detail:
      "no MX records, so senders fall back to the domain's own address record",
    name: domain,
  });

  if (!(await hasAddress(context, domain))) {
    return false;
  }

  context.report(DiagnosisCode.MX_IMPLICIT_A, {
    detail:
      "RFC 5321 §5.1 has senders deliver to the address record when no MX exists, so mail is arriving at whatever runs on that host — usually the web server, and usually by accident",
    name: domain,
  });

  return true;
}

export async function evaluateMx(
  context: EvaluationContext,
  check: MxCheck
): Promise<EvaluationResult> {
  const domain = normalise(check.domain);
  const exchanges = await readExchanges(context, domain);

  const finish = (extra: readonly Verdict[] = []): EvaluationResult => ({
    findings: context.findings,
    lookups: context.lookups,
    verdict: worstVerdict([verdictFromFindings(context.findings), ...extra]),
  });

  if (exchanges === undefined) {
    return finish(["indeterminate"]);
  }

  const deliverable = await routeMail(context, domain, exchanges);

  // The judgement, kept separate from the observations above. Whether any of
  // this is a problem depends on what the domain is for, and only the caller
  // knows that — so it is reported only when they said so.
  if (!deliverable && check.expectsMail === true) {
    context.report(DiagnosisCode.MX_MAIL_NOT_ACCEPTED, {
      detail:
        "this domain is expected to receive mail and nothing can deliver to it; if it only sends, that is correct and the check should say so",
      name: domain,
    });
  }

  return finish();
}

/** Everything about where mail goes, and whether it can get there at all. */
async function routeMail(
  context: EvaluationContext,
  domain: string,
  exchanges: readonly Exchange[]
): Promise<boolean> {
  if (exchanges.some(isNullMx)) {
    return reportNullMx(context, domain, exchanges);
  }

  if (exchanges.length === 0) {
    return await reportNoMx(context, domain);
  }

  // Independent of one another: no shared budget is spent in order and no
  // answer depends on which exchange resolves first.
  const usable = await Promise.all(
    exchanges.map((exchange) => checkExchange(context, domain, exchange))
  );

  // One working exchange is enough for mail to arrive. Counting findings on the
  // context instead would break the moment a pipeline shares one context across
  // evaluators, which is exactly what the next step does.
  return usable.some(Boolean);
}
