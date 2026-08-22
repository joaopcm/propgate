import { isIPv4, isIPv6 } from "node:net";
import { DiagnosisCode } from "../diagnosis/codes";
import { RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
import { reportTtlDisagreement } from "./answer";
import type { EvaluationContext } from "./context";
import type { EvaluationResult, Verdict } from "./types";
import { verdictFromFindings, worstVerdict } from "./types";

const RCODE_NXDOMAIN = 3;
const TRAILING_DOT = /\.$/;

const NULL_MX_PREFERENCE = 0;

export interface MxCheck {
  readonly domain: string;
  readonly expectsMail?: boolean;
}

interface Exchange {
  readonly host: string;
  readonly preference: number;
}

function normalise(name: string): string {
  return name.trim().replace(TRAILING_DOT, "").toLowerCase();
}

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

  const mx = recordsOfType(outcome.message.answers, "MX");

  reportTtlDisagreement(context, mx, domain);

  return mx.map((record) => ({
    host: normalise(record.rdata.exchange),
    preference: record.rdata.preference,
  }));
}

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

async function checkExchange(
  context: EvaluationContext,
  domain: string,
  exchange: Exchange
): Promise<boolean> {
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

function reportNullMx(
  context: EvaluationContext,
  domain: string,
  exchanges: readonly Exchange[]
): boolean {
  context.report(DiagnosisCode.MX_NULL, {
    detail:
      "senders that honour RFC 7505 reject immediately instead of retrying for days, which is the reason to publish it rather than simply having no MX",
    name: domain,
    observed: "0 .",
  });

  const others = exchanges.filter((exchange) => !isNullMx(exchange));

  if (others.length > 0) {
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

  if (!deliverable && check.expectsMail === true) {
    context.report(DiagnosisCode.MX_MAIL_NOT_ACCEPTED, {
      detail:
        "this domain is expected to receive mail and nothing can deliver to it; if it only sends, that is correct and the check should say so",
      name: domain,
    });
  }

  return finish();
}

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

  const usable = await Promise.all(
    exchanges.map((exchange) => checkExchange(context, domain, exchange))
  );

  return usable.some(Boolean);
}
