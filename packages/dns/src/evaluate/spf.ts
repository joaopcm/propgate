import { DiagnosisCode } from "../diagnosis/codes";
import { RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
import type { EvaluationContext } from "./context";
import type { SpfMechanism, SpfRecord, SpfTerm } from "./spf-record";
import {
  containsMacro,
  countsAsLookup,
  looksLikeSpf,
  parseSpfRecord,
} from "./spf-record";
import type { EvaluationResult, Verdict } from "./types";
import { verdictFromFindings, worstVerdict } from "./types";

/**
 * SPF evaluation (RFC 7208).
 *
 * The value of this check is almost entirely in the accounting, and the
 * accounting is what a regex over a TXT record cannot do at all.
 *
 *  1. **Ten lookups per evaluation, across the whole `include:` tree** (§4.6.4).
 *     A domain that adds one more sending service and silently crosses the line
 *     gets no warning from anywhere: the record still looks fine, and mail
 *     starts failing SPF at every receiver that enforces the limit.
 *  2. **Two void lookups.** A term whose target does not exist is nearly free
 *     to publish and permanently fatal to publish three of.
 *  3. **`temperror` is not `permerror`.** An `include:` into a zone that
 *     SERVFAILs is temporary — receivers defer rather than reject, and the
 *     record may be entirely correct. Reporting it as a configuration error
 *     sends the owner to edit something that needs no editing.
 *
 * Expansion is deliberately sequential. The limit is exact, so which term is
 * the eleventh depends on the order terms are evaluated in; issuing them
 * concurrently would both mis-attribute the overflow and perform lookups a
 * conforming implementation would never reach.
 *
 * Not here yet: matching a specific sending IP, which needs CIDR comparison for
 * `ip4`/`ip6`, address resolution for `a`/`mx`, and macro expansion against the
 * connection. This evaluator answers the two questions onboarding actually
 * asks — is the record sound, and does it authorise the platform being added.
 * Addresses are parsed and validated here; they are simply not matched yet.
 */

/** RFC 7208 §4.6.4. */
const SPF_MAX_LOOKUPS = 10;
const SPF_MAX_VOID_LOOKUPS = 2;
/** §4.6.4 also caps the names one `mx` mechanism may expand to. */
const SPF_MAX_MX_NAMES = 10;

/**
 * How little headroom is worth warning about.
 *
 * Receipt: adding one mainstream sending service costs between one and three
 * lookups — the `include:` term itself, plus whatever its record spends. The
 * two-level chain in the `spf.test` fixture costs two. So a domain with fewer
 * than three spare lookups is one integration away from breaking, and that is
 * the moment to say so rather than after the mail stops.
 */
const SPF_LOOKUP_HEADROOM = 3;

const RCODE_NXDOMAIN = 3;
const TRAILING_DOT = /\.$/;

export interface SpfCheck {
  readonly domain: string;
  /**
   * A sending source that must be authorised, given as the `include:` token the
   * platform publishes — `_spf.example-esp.com`. Matched anywhere in the
   * expanded tree, since an ESP reached through a customer's own aggregator is
   * authorised just the same.
   */
  readonly include?: string;
}

type SpfFailure =
  | { readonly kind: "temperror"; readonly at: string; readonly detail: string }
  | { readonly kind: "permerror"; readonly code: DiagnosisCode };

interface ExpansionState {
  failure: SpfFailure | undefined;
  /** SPF's own counter, distinct from the context's backstop budget. */
  lookups: number;
  /** Every `include:` / `redirect=` target reached, normalised for comparison. */
  readonly reached: Set<string>;
  voids: number;
}

type RecordRead =
  | { readonly kind: "one"; readonly raw: string }
  | { readonly kind: "none" }
  | { readonly kind: "multiple"; readonly count: number }
  | { readonly kind: "indeterminate"; readonly detail: string };

function normalise(domain: string): string {
  return domain.trim().replace(TRAILING_DOT, "").toLowerCase();
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

  // NXDOMAIN is an answer: the name does not exist. Any other non-zero rcode is
  // the server declining to tell us, which for SPF is a temperror.
  if (outcome.message.rcode !== 0 && outcome.message.rcode !== RCODE_NXDOMAIN) {
    return {
      detail: `the server answered rcode ${outcome.message.rcode}`,
      kind: "indeterminate",
    };
  }

  // §4.5 discards non-SPF records before counting, so a domain with one SPF
  // record and one verification token has one record rather than an ambiguity.
  const candidates = recordsOfType(outcome.message.answers, "TXT")
    .map((record) => record.rdata.value)
    .filter(looksLikeSpf);

  if (candidates.length > 1) {
    return { count: candidates.length, kind: "multiple" };
  }

  if (candidates.length === 0) {
    return { kind: "none" };
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

/** Whether a query found nothing, which is what §4.6.4 counts as a void. */
function isVoid(
  outcome: Awaited<ReturnType<EvaluationContext["lookup"]>>,
  type: "A" | "MX"
): boolean {
  if (outcome.status !== "answered") {
    return false;
  }

  return (
    outcome.message.rcode === RCODE_NXDOMAIN ||
    recordsOfType(outcome.message.answers, type).length === 0
  );
}

/**
 * Resolve an `a`, `mx` or `exists` term.
 *
 * Nothing is matched against a sending address yet. The query still has to
 * happen, because whether it comes back empty is what the void-lookup limit
 * counts, and a term that resolves to nothing is worth reporting on its own.
 */
async function resolveTerm(
  context: EvaluationContext,
  state: ExpansionState,
  mechanism: SpfMechanism,
  domain: string
): Promise<void> {
  const target = mechanism.value ?? domain;

  if (containsMacro(target)) {
    context.report(DiagnosisCode.SPF_MACRO_NOT_EVALUATED, {
      detail:
        "the term expands differently for every connection, so it cannot be resolved from the records alone",
      name: domain,
      observed: mechanism.raw,
    });
    return;
  }

  const type = mechanism.name === "mx" ? "MX" : "A";
  const outcome = await context.lookup({
    name: target,
    purpose: `${mechanism.raw} in the SPF record at ${domain}`,
    type: type === "MX" ? RecordType.MX : RecordType.A,
  });

  if (outcome.status !== "answered") {
    state.failure = {
      at: target,
      detail: `the ${type} lookup ${outcome.status}`,
      kind: "temperror",
    };
    return;
  }

  if (isVoid(outcome, type)) {
    context.report(DiagnosisCode.SPF_VOID_LOOKUP, {
      detail:
        "the term resolves to nothing, so it authorises nothing while still spending one of the ten lookups",
      name: target,
      observed: mechanism.raw,
    });
    spendVoid(context, state);
    return;
  }

  const names = recordsOfType(outcome.message.answers, "MX").length;

  if (type === "MX" && names > SPF_MAX_MX_NAMES) {
    context.report(DiagnosisCode.SPF_MX_LIMIT_EXCEEDED, {
      detail: `RFC 7208 §4.6.4 allows an mx mechanism to expand to at most ${SPF_MAX_MX_NAMES} names`,
      name: target,
      observed: `${names} MX records`,
    });
    state.failure = {
      code: DiagnosisCode.SPF_MX_LIMIT_EXCEEDED,
      kind: "permerror",
    };
  }
}

async function expandInclude(
  context: EvaluationContext,
  state: ExpansionState,
  mechanism: SpfMechanism,
  domain: string,
  chain: readonly string[]
): Promise<void> {
  const target = mechanism.value ?? "";

  if (containsMacro(target)) {
    context.report(DiagnosisCode.SPF_MACRO_NOT_EVALUATED, {
      detail:
        "the include target depends on the connection, so the tree below it cannot be walked from the records alone",
      name: domain,
      observed: mechanism.raw,
    });
    return;
  }

  const normalised = normalise(target);

  if (chain.includes(normalised)) {
    context.report(DiagnosisCode.SPF_INCLUDE_LOOP, {
      detail:
        "the chain returns to a domain it has already visited, so it can never terminate",
      name: domain,
      observed: [...chain, normalised].join(" -> "),
    });
    state.failure = { code: DiagnosisCode.SPF_INCLUDE_LOOP, kind: "permerror" };
    return;
  }

  state.reached.add(normalised);
  await walk(context, state, target, chain, `include:${target}`);
}

/**
 * Charge one of the ten lookups.
 *
 * Returns whether the budget survived. The eleventh term is the failure — the
 * tenth is still legal, which is why the comparison is strict.
 */
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

/**
 * Whether this term costs a lookup in this record's context.
 *
 * `redirect=` is the exception: §6.1 says it is ignored entirely when the record
 * has an `all`, because `all` always matches and evaluation never reaches the
 * modifier. Charging for it anyway would blame a term that never runs.
 */
function chargeable(term: SpfTerm, record: SpfRecord): boolean {
  if (!countsAsLookup(term)) {
    return false;
  }

  return !(term.kind === "modifier" && record.all !== undefined);
}

async function expandTerms(
  context: EvaluationContext,
  state: ExpansionState,
  record: SpfRecord,
  domain: string,
  chain: readonly string[]
): Promise<void> {
  for (const term of record.terms) {
    if (state.failure) {
      return;
    }

    // `all` always matches, so a receiver stops here and never spends a lookup
    // on anything written after it. Expanding past this point would charge the
    // record for terms it does not cost, and could raise a temperror from a
    // lookup no receiver ever makes.
    if (term.kind === "mechanism" && term.name === "all") {
      return;
    }

    if (!chargeable(term, record)) {
      continue;
    }

    if (!spendLookup(context, state)) {
      return;
    }

    // redirect= is charged here but followed after the mechanisms, since it
    // only applies once every one of them has failed to match.
    if (term.kind === "modifier") {
      continue;
    }

    if (term.name === "include") {
      // Sequential on purpose, and this is the one place in the codebase where
      // it is load-bearing: the ten-lookup limit is exact, so which term is the
      // eleventh depends on evaluation order. Expanding concurrently would
      // blame the wrong term and perform lookups a receiver never reaches.
      // biome-ignore lint/performance/noAwaitInLoops: the lookup limit is order-dependent
      await expandInclude(context, state, term, domain, chain);
      continue;
    }

    // The PTR query depends on the connecting IP, so there is nothing to
    // resolve from the records alone. The term still costs its lookup, and
    // publishing one at all is reported separately.
    if (term.name !== "ptr") {
      await resolveTerm(context, state, term, domain);
    }
  }
}

async function followRedirect(
  context: EvaluationContext,
  state: ExpansionState,
  record: SpfRecord,
  chain: readonly string[]
): Promise<void> {
  if (
    state.failure ||
    record.redirect === undefined ||
    record.all !== undefined
  ) {
    return;
  }

  state.reached.add(normalise(record.redirect));
  await walk(
    context,
    state,
    record.redirect,
    chain,
    `redirect=${record.redirect}`
  );
}

/**
 * Walk one included record and everything below it.
 *
 * `chain` is the include path taken to get here — used to detect a loop and to
 * name the path in findings. The lookup that produced this record was already
 * charged by the term that referenced it, so nothing is charged on entry.
 */
async function walk(
  context: EvaluationContext,
  state: ExpansionState,
  domain: string,
  chain: readonly string[],
  purpose: string
): Promise<void> {
  const read = await readSpfAt(context, domain, purpose);

  if (read.kind === "indeterminate") {
    state.failure = { at: domain, detail: read.detail, kind: "temperror" };
    return;
  }

  if (read.kind === "multiple") {
    reportMultiple(context, domain, read.count);
    state.failure = {
      code: DiagnosisCode.SPF_MULTIPLE_RECORDS,
      kind: "permerror",
    };
    return;
  }

  if (read.kind === "none") {
    // §5.2: an include: whose target publishes no SPF record is a permanent
    // error, not an empty result that the evaluation carries on past.
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
    return;
  }

  const parsed = parseSpfRecord(read.raw);

  if (!parsed.ok) {
    reportMalformed(context, domain, read.raw, parsed.detail, parsed.term);
    state.failure = {
      code: DiagnosisCode.SPF_RECORD_MALFORMED,
      kind: "permerror",
    };
    return;
  }

  reportIncludedRecord(context, parsed.record, domain);

  const nextChain = [...chain, normalise(domain)];

  await expandTerms(context, state, parsed.record, domain, nextChain);
  await followRedirect(context, state, parsed.record, nextChain);
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

/**
 * Findings that apply to any record in the tree.
 *
 * `+all` inside an `include:` is every bit as dangerous as at the top, because
 * the include matches whenever the included record would pass. The findings
 * about a domain's own posture — no `all`, `?all`, an ignored `redirect` — are
 * not reported here: on an included record those are normal and reporting them
 * would put a warning on almost every ESP a customer uses.
 */
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

  // Modifiers are position-independent, so only mechanisms after `all` are dead.
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

/** Findings about the checked domain's own posture. */
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

/**
 * A temperror is deliberately `indeterminate` rather than `fail`.
 *
 * Receivers defer on temperror instead of rejecting, and the record may be
 * perfectly correct — a resolver blipped, or a zone below it is momentarily
 * broken. Calling it a misconfiguration sends someone to edit a record that
 * needs no editing. Turning a persistent one into news is what Phase 2's
 * consecutive-failure thresholds are for.
 */
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

/**
 * Fold everything reported so far into one verdict.
 *
 * Severity lives in the registry, so nothing here decides how bad a finding is
 * a second time. `extra` is for the one thing findings cannot express:
 * `indeterminate`, which says what the evaluator could see rather than what it
 * found.
 */
function finalVerdict(
  context: EvaluationContext,
  extra: readonly Verdict[] = []
): Verdict {
  return worstVerdict([verdictFromFindings(context.findings), ...extra]);
}

export async function evaluateSpf(
  context: EvaluationContext,
  check: SpfCheck
): Promise<EvaluationResult> {
  const state: ExpansionState = {
    failure: undefined,
    lookups: 0,
    reached: new Set<string>(),
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

  await expandTerms(context, state, parsed.record, check.domain, chain);
  await followRedirect(context, state, parsed.record, chain);

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

  return finish(finalVerdict(context));
}
