import { DiagnosisCode } from "../diagnosis/codes";
import type { QueryOutcome } from "../transport/types";
import { RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
import { reportAnswerShape } from "./answer";
import type { EvaluationContext } from "./context";
import type { IpAddress } from "./spf-ip";
import { cidrContains, fullPrefix, parseIpAddress } from "./spf-ip";
import type { MacroContext } from "./spf-macro";
import { expandMacros } from "./spf-macro";
import type {
  SpfMechanism,
  SpfQualifier,
  SpfRecord,
  SpfTerm,
} from "./spf-record";
import { countsAsLookup, looksLikeSpf, parseSpfRecord } from "./spf-record";
import type { EvaluationResult, Verdict } from "./types";
import { verdictFromFindings, worstVerdict } from "./types";

const SPF_MAX_LOOKUPS = 10;
const SPF_MAX_VOID_LOOKUPS = 2;
const SPF_MAX_MX_NAMES = 10;

const SPF_LOOKUP_HEADROOM = 3;

const RCODE_NXDOMAIN = 3;
const TRAILING_DOT = /\.$/;

export interface SpfCheck {
  readonly domain: string;
  readonly helo?: string;
  readonly include?: string;
  readonly ip?: string;
  readonly sender?: string;
}

type SpfFailure =
  | { readonly kind: "temperror"; readonly at: string; readonly detail: string }
  | { readonly kind: "permerror"; readonly code: DiagnosisCode };

type MatchResult =
  | {
      readonly kind: "match";
      readonly qualifier: SpfQualifier;
      readonly mechanism: string;
      readonly at: string;
    }
  | { readonly kind: "none" }
  | { readonly kind: "undetermined"; readonly because: string };

const NO_MATCH: MatchResult = { kind: "none" };

interface ExpansionState {
  readonly client: IpAddress | undefined;
  failure: SpfFailure | undefined;
  readonly helo: string | undefined;
  lookups: number;
  readonly reached: Set<string>;
  readonly sender: string | undefined;
  voids: number;
}

type RecordRead =
  | { readonly kind: "one"; readonly raw: string }
  | { readonly kind: "none"; readonly outcome: QueryOutcome }
  | { readonly kind: "multiple"; readonly count: number }
  | { readonly kind: "indeterminate"; readonly detail: string };

function normalise(domain: string): string {
  return domain.trim().replace(TRAILING_DOT, "").toLowerCase();
}

function matched(
  mechanism: SpfMechanism,
  domain: string
): Extract<MatchResult, { kind: "match" }> {
  return {
    at: domain,
    kind: "match",
    mechanism: mechanism.raw,
    qualifier: mechanism.qualifier,
  };
}

async function readSpfAt(
  context: EvaluationContext,
  domain: string,
  purpose: string
): Promise<RecordRead> {
  const outcome = await context.lookup({
    name: domain,
    purpose,
    type: RecordType.TXT,
  });

  if (outcome.status !== "answered") {
    return { detail: `the lookup ${outcome.status}`, kind: "indeterminate" };
  }

  if (outcome.message.rcode !== 0 && outcome.message.rcode !== RCODE_NXDOMAIN) {
    return {
      detail: `the server answered rcode ${outcome.message.rcode}`,
      kind: "indeterminate",
    };
  }

  const candidates = recordsOfType(outcome.message.answers, "TXT")
    .map((record) => record.rdata.value)
    .filter(looksLikeSpf);

  if (candidates.length > 1) {
    return { count: candidates.length, kind: "multiple" };
  }

  if (candidates.length === 0) {
    return { kind: "none", outcome };
  }

  return { kind: "one", raw: candidates[0] ?? "" };
}

function spendVoid(context: EvaluationContext, state: ExpansionState): void {
  state.voids += 1;

  if (state.voids > SPF_MAX_VOID_LOOKUPS) {
    state.failure = {
      code: DiagnosisCode.SPF_VOID_LOOKUP_LIMIT_EXCEEDED,
      kind: "permerror",
    };
    context.report(DiagnosisCode.SPF_VOID_LOOKUP_LIMIT_EXCEEDED, {
      detail:
        "more than two terms resolve to nothing, which RFC 7208 §4.6.4 makes a permanent error even though each one looks harmless on its own",
      expected: `at most ${SPF_MAX_VOID_LOOKUPS} void lookups`,
      observed: `${state.voids} void lookups`,
    });
  }
}

function isVoid(
  outcome: Awaited<ReturnType<EvaluationContext["lookup"]>>,
  type: "A" | "AAAA" | "MX"
): boolean {
  if (outcome.status !== "answered") {
    return false;
  }

  return (
    outcome.message.rcode === RCODE_NXDOMAIN ||
    recordsOfType(outcome.message.answers, type).length === 0
  );
}

function anyAddressMatches(
  client: IpAddress,
  addresses: readonly string[],
  mechanism: SpfMechanism
): boolean {
  const prefix =
    (client.family === "ipv4" ? mechanism.prefix4 : mechanism.prefix6) ??
    fullPrefix(client.family);

  for (const text of addresses) {
    const network = parseIpAddress(text);

    if (network !== null && cidrContains(network, prefix, client)) {
      return true;
    }
  }

  return false;
}

function addressesIn(
  outcome: Awaited<ReturnType<EvaluationContext["lookup"]>>
): string[] {
  if (outcome.status !== "answered") {
    return [];
  }

  return [
    ...recordsOfType(outcome.message.answers, "A").map(
      (record) => record.rdata.address
    ),
    ...recordsOfType(outcome.message.answers, "AAAA").map(
      (record) => record.rdata.address
    ),
  ];
}

async function mxAddresses(
  context: EvaluationContext,
  names: readonly string[],
  mechanism: SpfMechanism,
  client: IpAddress
): Promise<boolean> {
  const outcomes = await Promise.all(
    names.map((name) =>
      context.lookup({
        name,
        purpose: `an address for ${name}, named by ${mechanism.raw}`,
        type: client.family === "ipv4" ? RecordType.A : RecordType.AAAA,
      })
    )
  );

  return outcomes.some((outcome) =>
    anyAddressMatches(client, addressesIn(outcome), mechanism)
  );
}

function resolveTarget(
  context: EvaluationContext,
  state: ExpansionState,
  mechanism: SpfMechanism,
  target: string,
  domain: string
): { readonly name: string } | MatchResult {
  const expansion = expandMacros(target, macroContext(state, domain));

  if (expansion.ok) {
    return { name: expansion.value };
  }

  if (expansion.reason === "syntax") {
    reportMalformed(
      context,
      domain,
      mechanism.raw,
      expansion.detail,
      mechanism.raw
    );
    state.failure = {
      code: DiagnosisCode.SPF_RECORD_MALFORMED,
      kind: "permerror",
    };
    return NO_MATCH;
  }

  context.report(DiagnosisCode.SPF_MACRO_NOT_EVALUATED, {
    detail: `${expansion.detail}, so this term cannot be resolved from the records alone`,
    name: domain,
    observed: mechanism.raw,
  });

  return state.client === undefined
    ? NO_MATCH
    : { because: mechanism.raw, kind: "undetermined" };
}

function macroContext(state: ExpansionState, domain: string): MacroContext {
  return {
    domain,
    ...(state.helo === undefined ? {} : { helo: state.helo }),
    ...(state.client === undefined ? {} : { ip: state.client }),
    ...(state.sender === undefined ? {} : { sender: state.sender }),
  };
}

async function resolveTerm(
  context: EvaluationContext,
  state: ExpansionState,
  mechanism: SpfMechanism,
  domain: string
): Promise<MatchResult> {
  const resolved = resolveTarget(
    context,
    state,
    mechanism,
    mechanism.value ?? domain,
    domain
  );

  if (!("name" in resolved)) {
    return resolved;
  }

  const target = resolved.name;

  const type = answerTypeFor(mechanism, state.client);
  const outcome = await context.lookup({
    name: target,
    purpose: `${mechanism.raw} in the SPF record at ${domain}`,
    type: RecordType[type],
  });

  if (outcome.status !== "answered") {
    state.failure = {
      at: target,
      detail: `the ${type} lookup ${outcome.status}`,
      kind: "temperror",
    };
    return NO_MATCH;
  }

  if (isVoid(outcome, type)) {
    context.report(DiagnosisCode.SPF_VOID_LOOKUP, {
      detail:
        "the term resolves to nothing, so it authorises nothing while still spending one of the ten lookups",
      name: target,
      observed: mechanism.raw,
    });
    spendVoid(context, state);
    return NO_MATCH;
  }

  if (mechanism.name === "mx") {
    return await matchMx(context, state, mechanism, outcome, target);
  }

  if (mechanism.name === "exists") {
    return matched(mechanism, domain);
  }

  if (state.client === undefined) {
    return NO_MATCH;
  }

  return anyAddressMatches(state.client, addressesIn(outcome), mechanism)
    ? matched(mechanism, domain)
    : NO_MATCH;
}

function answerTypeFor(
  mechanism: SpfMechanism,
  client: IpAddress | undefined
): "A" | "AAAA" | "MX" {
  if (mechanism.name === "mx") {
    return "MX";
  }

  return mechanism.name === "a" && client?.family === "ipv6" ? "AAAA" : "A";
}

async function matchMx(
  context: EvaluationContext,
  state: ExpansionState,
  mechanism: SpfMechanism,
  outcome: Awaited<ReturnType<EvaluationContext["lookup"]>>,
  target: string
): Promise<MatchResult> {
  if (outcome.status !== "answered") {
    return NO_MATCH;
  }

  const names = recordsOfType(outcome.message.answers, "MX").map((record) =>
    normalise(record.rdata.exchange)
  );

  if (names.length > SPF_MAX_MX_NAMES) {
    context.report(DiagnosisCode.SPF_MX_LIMIT_EXCEEDED, {
      detail: `RFC 7208 §4.6.4 allows an mx mechanism to expand to at most ${SPF_MAX_MX_NAMES} names`,
      name: target,
      observed: `${names.length} MX records`,
    });
    state.failure = {
      code: DiagnosisCode.SPF_MX_LIMIT_EXCEEDED,
      kind: "permerror",
    };
    return NO_MATCH;
  }

  if (state.client === undefined) {
    return NO_MATCH;
  }

  return (await mxAddresses(context, names, mechanism, state.client))
    ? matched(mechanism, target)
    : NO_MATCH;
}

function spendLookup(
  context: EvaluationContext,
  state: ExpansionState
): boolean {
  state.lookups += 1;

  if (state.lookups <= SPF_MAX_LOOKUPS) {
    return true;
  }

  context.report(DiagnosisCode.SPF_LOOKUP_LIMIT_EXCEEDED, {
    detail:
      "receivers that enforce the limit return permerror, which most treat as an SPF failure; flattening the largest include is the usual fix",
    expected: `at most ${SPF_MAX_LOOKUPS} lookups`,
    observed: `${state.lookups} lookups and still expanding`,
  });
  state.failure = {
    code: DiagnosisCode.SPF_LOOKUP_LIMIT_EXCEEDED,
    kind: "permerror",
  };

  return false;
}

function chargeable(term: SpfTerm, record: SpfRecord): boolean {
  if (!countsAsLookup(term)) {
    return false;
  }

  return !(term.kind === "modifier" && record.all !== undefined);
}

function includeMatches(
  inner: MatchResult,
  mechanism: SpfMechanism,
  domain: string
): MatchResult {
  if (inner.kind === "undetermined") {
    return inner;
  }

  if (inner.kind === "match" && inner.qualifier === "+") {
    return matched(mechanism, domain);
  }

  return NO_MATCH;
}

async function expandInclude(
  context: EvaluationContext,
  state: ExpansionState,
  mechanism: SpfMechanism,
  domain: string,
  chain: readonly string[]
): Promise<MatchResult> {
  const resolved = resolveTarget(
    context,
    state,
    mechanism,
    mechanism.value ?? "",
    domain
  );

  if (!("name" in resolved)) {
    return resolved;
  }

  const target = resolved.name;
  const normalised = normalise(target);

  if (chain.includes(normalised)) {
    context.report(DiagnosisCode.SPF_INCLUDE_LOOP, {
      detail:
        "the chain returns to a domain it has already visited, so it can never terminate",
      name: domain,
      observed: [...chain, normalised].join(" -> "),
    });
    state.failure = { code: DiagnosisCode.SPF_INCLUDE_LOOP, kind: "permerror" };
    return NO_MATCH;
  }

  state.reached.add(normalised);

  const inner = await walk(context, state, target, chain, `include:${target}`);

  return includeMatches(inner, mechanism, domain);
}

function firstOf(current: MatchResult, next: MatchResult): MatchResult {
  if (current.kind !== "none") {
    return current;
  }

  return next;
}

function matchWithoutDns(
  state: ExpansionState,
  term: SpfTerm,
  domain: string
): MatchResult | undefined {
  if (term.kind !== "mechanism") {
    return;
  }

  if (term.name !== "ip4" && term.name !== "ip6") {
    return;
  }

  return matchNetwork(state, term, domain);
}

function matchPtr(state: ExpansionState, term: SpfMechanism): MatchResult {
  return state.client === undefined
    ? NO_MATCH
    : { because: term.raw, kind: "undetermined" };
}

async function resolveOrInclude(
  context: EvaluationContext,
  state: ExpansionState,
  term: SpfMechanism,
  domain: string,
  chain: readonly string[]
): Promise<MatchResult> {
  if (term.name === "ptr") {
    return matchPtr(state, term);
  }

  if (term.name === "include") {
    return await expandInclude(context, state, term, domain, chain);
  }

  return await resolveTerm(context, state, term, domain);
}

async function expandTerms(
  context: EvaluationContext,
  state: ExpansionState,
  record: SpfRecord,
  domain: string,
  chain: readonly string[]
): Promise<MatchResult> {
  let result: MatchResult = NO_MATCH;

  for (const term of record.terms) {
    if (state.failure) {
      return result;
    }

    if (term.kind === "mechanism" && term.name === "all") {
      return firstOf(result, matched(term, domain));
    }

    const local = matchWithoutDns(state, term, domain);

    if (local !== undefined) {
      result = firstOf(result, local);
      continue;
    }

    if (!chargeable(term, record)) {
      continue;
    }

    if (!spendLookup(context, state)) {
      return result;
    }

    if (term.kind === "modifier") {
      continue;
    }

    // biome-ignore lint/performance/noAwaitInLoops: the lookup limit is order-dependent
    const outcome = await resolveOrInclude(context, state, term, domain, chain);

    result = firstOf(result, outcome);
  }

  return result;
}

function matchNetwork(
  state: ExpansionState,
  mechanism: SpfMechanism,
  domain: string
): MatchResult {
  const { client } = state;

  if (client === undefined || mechanism.value === undefined) {
    return NO_MATCH;
  }

  const network = parseIpAddress(mechanism.value);

  if (network === null) {
    return NO_MATCH;
  }

  const prefix =
    (mechanism.name === "ip4" ? mechanism.prefix4 : mechanism.prefix6) ??
    fullPrefix(network.family);

  return cidrContains(network, prefix, client)
    ? matched(mechanism, domain)
    : NO_MATCH;
}

async function followRedirect(
  context: EvaluationContext,
  state: ExpansionState,
  record: SpfRecord,
  chain: readonly string[],
  soFar: MatchResult
): Promise<MatchResult> {
  if (
    state.failure ||
    record.redirect === undefined ||
    record.all !== undefined
  ) {
    return soFar;
  }

  state.reached.add(normalise(record.redirect));

  const inner = await walk(
    context,
    state,
    record.redirect,
    chain,
    `redirect=${record.redirect}`
  );

  return soFar.kind === "none" ? inner : soFar;
}

async function walk(
  context: EvaluationContext,
  state: ExpansionState,
  domain: string,
  chain: readonly string[],
  purpose: string
): Promise<MatchResult> {
  const read = await readSpfAt(context, domain, purpose);

  if (read.kind === "indeterminate") {
    state.failure = { at: domain, detail: read.detail, kind: "temperror" };
    return NO_MATCH;
  }

  if (read.kind === "multiple") {
    reportMultiple(context, domain, read.count);
    state.failure = {
      code: DiagnosisCode.SPF_MULTIPLE_RECORDS,
      kind: "permerror",
    };
    return NO_MATCH;
  }

  if (read.kind === "none") {
    context.report(DiagnosisCode.SPF_INCLUDE_UNRESOLVABLE, {
      detail:
        "the target publishes no SPF record, which makes the whole evaluation a permanent error rather than simply matching nothing",
      name: domain,
      observed: [...chain, normalise(domain)].join(" -> "),
    });
    state.failure = {
      code: DiagnosisCode.SPF_INCLUDE_UNRESOLVABLE,
      kind: "permerror",
    };
    return NO_MATCH;
  }

  const parsed = parseSpfRecord(read.raw);

  if (!parsed.ok) {
    reportMalformed(context, domain, read.raw, parsed.detail, parsed.term);
    state.failure = {
      code: DiagnosisCode.SPF_RECORD_MALFORMED,
      kind: "permerror",
    };
    return NO_MATCH;
  }

  reportIncludedRecord(context, parsed.record, domain);

  const nextChain = [...chain, normalise(domain)];
  const result = await expandTerms(
    context,
    state,
    parsed.record,
    domain,
    nextChain
  );

  return await followRedirect(context, state, parsed.record, nextChain, result);
}

function reportMultiple(
  context: EvaluationContext,
  domain: string,
  count: number
): void {
  context.report(DiagnosisCode.SPF_MULTIPLE_RECORDS, {
    detail:
      "RFC 7208 §4.5 makes more than one SPF record a permanent error, so nothing is authorised — the two must be merged into one",
    name: domain,
    observed: `${count} records`,
  });
}

function reportMalformed(
  context: EvaluationContext,
  domain: string,
  raw: string,
  detail: string,
  term: string | undefined
): void {
  context.report(DiagnosisCode.SPF_RECORD_MALFORMED, {
    detail: term ? `${detail} (in "${term}")` : detail,
    name: domain,
    observed: raw,
  });
}

function reportIncludedRecord(
  context: EvaluationContext,
  record: SpfRecord,
  domain: string
): void {
  if (record.all?.qualifier === "+") {
    context.report(DiagnosisCode.SPF_ALL_PASS, {
      detail:
        "+all authorises every host on the internet, and an include: of a record that says it inherits exactly that",
      name: domain,
      observed: record.all.raw,
    });
  }

  if (record.terms.some((t) => t.kind === "mechanism" && t.name === "ptr")) {
    context.report(DiagnosisCode.SPF_PTR_MECHANISM, {
      detail:
        "RFC 7208 §5.5 says ptr SHOULD NOT be published: it is slow, unreliable, and some receivers ignore it outright",
      name: domain,
      observed: record.raw,
    });
  }

  reportUnreachableTerms(context, record, domain);
}

function reportUnreachableTerms(
  context: EvaluationContext,
  record: SpfRecord,
  domain: string
): void {
  const allIndex = record.terms.findIndex(
    (term) => term.kind === "mechanism" && term.name === "all"
  );

  if (allIndex === -1) {
    return;
  }

  const unreachable = record.terms
    .slice(allIndex + 1)
    .filter((term) => term.kind === "mechanism");

  if (unreachable.length === 0) {
    return;
  }

  context.report(DiagnosisCode.SPF_TERMS_AFTER_ALL, {
    detail:
      "all always matches, so these mechanisms never run — they look like they authorise senders and do not",
    name: domain,
    observed: unreachable.map((term) => term.raw).join(" "),
  });
}

function reportPosture(
  context: EvaluationContext,
  record: SpfRecord,
  domain: string
): void {
  reportIncludedRecord(context, record, domain);

  if (record.all?.qualifier === "?") {
    context.report(DiagnosisCode.SPF_ALL_NEUTRAL, {
      detail:
        "?all states no opinion about unlisted senders, so the record does not protect the domain from being forged",
      name: domain,
      observed: record.all.raw,
    });
    return;
  }

  if (record.all !== undefined && record.redirect !== undefined) {
    context.report(DiagnosisCode.SPF_REDIRECT_IGNORED, {
      detail:
        "all always matches, so evaluation stops before the redirect and the target's record is never consulted",
      name: domain,
      observed: record.raw,
    });
    return;
  }

  if (record.all === undefined && record.redirect === undefined) {
    context.report(DiagnosisCode.SPF_ALL_MISSING, {
      detail:
        "with no all mechanism the result for an unlisted sender is neutral, which receivers treat much like having no record",
      name: domain,
      observed: record.raw,
    });
  }
}

function reportLookupUsage(
  context: EvaluationContext,
  state: ExpansionState,
  domain: string
): void {
  if (state.lookups <= SPF_MAX_LOOKUPS - SPF_LOOKUP_HEADROOM) {
    return;
  }

  context.report(DiagnosisCode.SPF_LOOKUP_LIMIT_NEAR, {
    detail: `${SPF_MAX_LOOKUPS - state.lookups} of the ten lookups are left, so the next sending service added is likely to break SPF outright`,
    expected: `at most ${SPF_MAX_LOOKUPS - SPF_LOOKUP_HEADROOM} lookups, to leave room to grow`,
    name: domain,
    observed: `${state.lookups} lookups`,
  });
}

function reportAuthorization(
  context: EvaluationContext,
  state: ExpansionState,
  check: SpfCheck
): void {
  if (state.reached.has(normalise(check.include ?? ""))) {
    return;
  }

  context.report(DiagnosisCode.SPF_SOURCE_NOT_AUTHORIZED, {
    detail: `add include:${check.include} before the all mechanism; added after it, the term never runs`,
    expected: `include:${check.include}`,
    name: check.domain,
    observed:
      state.reached.size === 0
        ? "no include: or redirect= terms at all"
        : [...state.reached].join(", "),
  });
}

const QUALIFIER_CODES: Readonly<Record<SpfQualifier, DiagnosisCode>> = {
  "-": DiagnosisCode.SPF_IP_NOT_AUTHORIZED,
  "?": DiagnosisCode.SPF_IP_NEUTRAL,
  "+": DiagnosisCode.SPF_IP_AUTHORIZED,
  "~": DiagnosisCode.SPF_IP_SOFTFAIL,
};

const QUALIFIER_DETAIL: Readonly<Record<SpfQualifier, string>> = {
  "-": "the record rejects this host outright, and receivers that honour it will refuse the message",
  "?": "the record states no opinion about this host, which receivers treat much like no record at all",
  "+": "the record authorises this host",
  "~": "the record marks this host as probably unauthorised; receivers usually accept and flag rather than reject",
};

function reportIpResult(
  context: EvaluationContext,
  result: MatchResult,
  client: IpAddress,
  domain: string
): void {
  if (result.kind === "undetermined") {
    context.report(DiagnosisCode.SPF_IP_UNDETERMINED, {
      detail: `${result.because} depends on the connection rather than on the records, so whether this host passes cannot be decided from DNS alone`,
      name: domain,
      observed: client.text,
    });
    return;
  }

  if (result.kind === "none") {
    context.report(DiagnosisCode.SPF_IP_NEUTRAL, {
      detail:
        "no mechanism matched and the record has no all, so the result defaults to neutral",
      name: domain,
      observed: client.text,
    });
    return;
  }

  context.report(QUALIFIER_CODES[result.qualifier], {
    detail: `${result.mechanism} at ${result.at} is the first mechanism that matches, and ${QUALIFIER_DETAIL[result.qualifier]}`,
    name: domain,
    observed: client.text,
  });
}

function reportTemperror(
  context: EvaluationContext,
  failure: Extract<SpfFailure, { kind: "temperror" }>
): Verdict {
  context.report(DiagnosisCode.SPF_TEMPORARY_FAILURE, {
    detail: `${failure.detail}; receivers defer messages rather than reject them, and the record itself may be correct`,
    name: failure.at,
  });

  return "indeterminate";
}

function finalVerdict(
  context: EvaluationContext,
  extra: readonly Verdict[] = []
): Verdict {
  return worstVerdict([verdictFromFindings(context.findings), ...extra]);
}

function parseClient(
  context: EvaluationContext,
  check: SpfCheck
): IpAddress | undefined {
  if (check.ip === undefined) {
    return;
  }

  const client = parseIpAddress(check.ip);

  if (client === null) {
    context.report(DiagnosisCode.SPF_IP_UNDETERMINED, {
      detail:
        "the address given to check against is not an IPv4 or IPv6 address",
      name: check.domain,
      observed: check.ip,
    });
    return;
  }

  return client;
}

export async function evaluateSpf(
  context: EvaluationContext,
  check: SpfCheck
): Promise<EvaluationResult> {
  const client = parseClient(context, check);
  const state: ExpansionState = {
    client,
    failure: undefined,
    helo: check.helo,
    lookups: 0,
    reached: new Set<string>(),
    sender: check.sender,
    voids: 0,
  };

  const finish = (verdict: Verdict): EvaluationResult => ({
    findings: context.findings,
    lookups: context.lookups,
    verdict,
  });

  const initial = await readSpfAt(
    context,
    check.domain,
    "the domain's SPF record"
  );

  if (initial.kind === "indeterminate") {
    return finish(
      finalVerdict(context, [
        reportTemperror(context, {
          at: check.domain,
          detail: initial.detail,
          kind: "temperror",
        }),
      ])
    );
  }

  if (initial.kind === "none") {
    context.report(DiagnosisCode.SPF_RECORD_MISSING, {
      detail:
        "with no SPF record, receivers have nothing to check a sending host against",
      name: check.domain,
    });
    reportAnswerShape(context, initial.outcome, check.domain);

    return finish(finalVerdict(context));
  }

  if (initial.kind === "multiple") {
    reportMultiple(context, check.domain, initial.count);
    return finish(finalVerdict(context));
  }

  const parsed = parseSpfRecord(initial.raw);

  if (!parsed.ok) {
    reportMalformed(
      context,
      check.domain,
      initial.raw,
      parsed.detail,
      parsed.term
    );
    return finish(finalVerdict(context));
  }

  reportPosture(context, parsed.record, check.domain);

  const chain = [normalise(check.domain)];
  const expanded = await expandTerms(
    context,
    state,
    parsed.record,
    check.domain,
    chain
  );
  const result = await followRedirect(
    context,
    state,
    parsed.record,
    chain,
    expanded
  );

  if (state.failure?.kind === "temperror") {
    return finish(
      finalVerdict(context, [reportTemperror(context, state.failure)])
    );
  }

  if (state.failure) {
    return finish(finalVerdict(context));
  }

  reportLookupUsage(context, state, check.domain);

  if (check.include !== undefined) {
    reportAuthorization(context, state, check);
  }

  if (client !== undefined) {
    reportIpResult(context, result, client, check.domain);
  }

  return finish(finalVerdict(context));
}
