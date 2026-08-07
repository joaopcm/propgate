import { getServers } from "node:dns";
import {
  CHECK_KINDS,
  type CheckKind,
  DIAGNOSIS_REGISTRY,
  type DiagnosisCode,
  type DomainProfile,
  type Finding,
  runChecks,
  type ServerAddress,
  type Verdict,
} from "@propgate/dns";
import { parseResolver } from "../args";
import { apiRequest } from "../client";
import type { Command, Input } from "../command";
import { EXIT_USAGE } from "../exit";
import { type Context, out, reportApiError } from "../output";
import { exitCodeFor, type Renderable, render, type Style } from "../report";
import { looksLikeId } from "./shared";

/**
 * `propgate check <domain>`
 *
 * The same engine as the public checker and the API. Three surfaces, one
 * implementation — and the local run is the one to reach for when a customer
 * reports something odd, because it runs against whichever resolver *they* are
 * using rather than against ours.
 *
 * `--remote` asks our API the same question instead, which is the right call
 * when what you want to know is what propgate sees. Neither writes anything:
 * this command never touches a registered domain. That is `domains check`, and
 * the difference is deliberate — see the redirect below.
 */

/** Generous enough that a slow authority is not mistaken for a dead one. */
const BUDGET_MS = 15_000;
const TIMEOUT_MS = 4000;
const MAX_LOOKUPS = 100;

const TRAILING_DOT = /\.$/;

/** Normalisation lives here so the local and remote paths send the same string. */
function normaliseDomain(value: string): string {
  return value.trim().replace(TRAILING_DOT, "").toLowerCase();
}

function usage(message: string): number {
  process.stderr.write(`propgate: ${message}\n`);

  return EXIT_USAGE;
}

/**
 * The resolver to query when none was given.
 *
 * `node:dns` is read here for its *configuration* — `getServers` returns what
 * the machine is set up with and makes no query. The package's rule is that
 * nothing resolves through c-ares, and nothing does: every packet is still
 * built and parsed by `@propgate/dns`.
 */
function systemResolver(): ServerAddress | string {
  const [first] = getServers();

  if (first === undefined) {
    return "no resolver is configured on this machine; pass --resolver";
  }

  return parseResolver(first);
}

/**
 * `--cname track=track.example.net` into the pair it names.
 *
 * Split on the first `=`. Unambiguous because the right-hand side is a hostname
 * and a hostname cannot contain one — unlike `--token`, whose value routinely
 * does, which is why the label there is a flag of its own rather than a prefix.
 */
function parseCname(value: string): { label: string; target: string } | string {
  const at = value.indexOf("=");

  if (at < 1 || at === value.length - 1) {
    return `--cname takes <label>=<target>, e.g. track=track.example.net (got "${value}")`;
  }

  return { label: value.slice(0, at), target: value.slice(at + 1) };
}

/** Tokens and aliases, or the first one that could not be read. */
function recordsFor(input: Input):
  | {
      readonly cnames: readonly { label: string; target: string }[];
      readonly ok: true;
      readonly ownership: readonly { label?: string; token: string }[];
    }
  | { readonly message: string; readonly ok: false } {
  const cnames: { label: string; target: string }[] = [];

  for (const value of input.list("cname")) {
    const parsed = parseCname(value);

    if (typeof parsed === "string") {
      return { message: parsed, ok: false };
    }

    cnames.push(parsed);
  }

  const token = input.text("token");
  const label = input.text("token-at");

  if (token === undefined && label !== undefined) {
    return {
      message: "--token-at names where a token goes, but no --token was given",
      ok: false,
    };
  }

  return {
    cnames,
    ok: true,
    ownership:
      token === undefined
        ? []
        : [{ token, ...(label === undefined ? {} : { label }) }],
  };
}

/**
 * A check named explicitly with nothing to check it against.
 *
 * Only fires for `--only`, and only for the two kinds that cannot run without a
 * value. Asking for everything is a different statement — the default runs each
 * check that has something to work with and stays quiet about the rest, which is
 * what makes `propgate check example.com` useful with no flags at all.
 *
 * DKIM and CAA have the same hole and are deliberately left alone here: changing
 * what `--only dkim` does today is a decision of its own, not a consequence of
 * adding two evaluators.
 */
function unfeedable(
  input: Input,
  records: { cnames: readonly unknown[]; ownership: readonly unknown[] }
): string | undefined {
  const only = input.list("only");

  if (only.includes("ownership") && records.ownership.length === 0) {
    return "--only ownership needs a --token to compare against";
  }

  if (only.includes("cname") && records.cnames.length === 0) {
    return "--only cname needs a --cname <label>=<target> to compare against";
  }
}

function profileFor(
  input: Input,
  records: {
    cnames: readonly { label: string; target: string }[];
    ownership: readonly { label?: string; token: string }[];
  }
): DomainProfile {
  const selectors = input.list("selector");
  const only = input.list("only");
  const caaIssuer = input.text("caa-issuer");
  const spfInclude = input.text("spf-include");

  return {
    // `only` came through a `multiselect` whose choices are `CHECK_KINDS`, so
    // `resolve` has already refused anything that is not one.
    checks:
      only.length === 0 ? [...CHECK_KINDS] : (only as readonly CheckKind[]),
    id: "cli",
    // Tri-state on purpose: absent makes no claim, and `false` would assert that
    // the domain receives no mail, which is a different statement entirely.
    ...(input.bool("receives-mail") ? { mx: [{ expectsMail: true }] } : {}),
    ...(caaIssuer === undefined ? {} : { caaIssuer }),
    ...(records.cnames.length === 0 ? {} : { cnames: records.cnames }),
    ...(selectors.length === 0 ? {} : { dkimSelectors: selectors }),
    ...(records.ownership.length === 0 ? {} : { ownership: records.ownership }),
    // Unlabelled, like the API's public checker: `propgate check` diagnoses the
    // name it was given. A bounce host is a name of its own — check it directly.
    ...(spfInclude === undefined ? {} : { spf: [{ include: spfInclude }] }),
  };
}

/** The machine-readable form, carrying the taxonomy exactly as the API does. */
function toJson(result: Renderable) {
  return {
    checks: result.checks.map((outcome) => ({
      findings: outcome.findings.map((finding) => ({
        code: finding.code,
        evidence: finding.evidence,
        severity: finding.severity,
        slug: DIAGNOSIS_REGISTRY[finding.code as DiagnosisCode]?.slug ?? null,
        summary:
          DIAGNOSIS_REGISTRY[finding.code as DiagnosisCode]?.summary ?? null,
      })),
      kind: outcome.kind,
      lookups: outcome.lookups.map((lookup) => ({
        name: lookup.name,
        purpose: lookup.purpose,
        status: lookup.outcome.status,
        type: lookup.type,
      })),
      verdict: outcome.verdict,
    })),
    domain: result.domain,
    verdict: result.verdict,
  };
}

function present(result: Renderable, input: Input, json: boolean): number {
  if (json) {
    out(JSON.stringify(toJson(result), null, 2));
  } else {
    // Colour off when stdout is not a terminal, so a pipe stays clean.
    const style: Style = { colour: process.stdout.isTTY === true };

    out(render(result, { style, trace: input.bool("trace") }).join("\n"));
  }

  return exitCodeFor(result);
}

interface RemoteFinding {
  readonly code: string;
  readonly evidence: Finding["evidence"];
  readonly severity: Finding["severity"];
}

interface RemoteCheck {
  readonly findings: readonly RemoteFinding[];
  readonly kind: string;
  readonly lookups: readonly {
    readonly name: string;
    readonly purpose: string;
    readonly status: string;
    readonly type: number;
  }[];
  readonly verdict: Verdict;
}

interface RemoteResult {
  readonly checks: readonly RemoteCheck[];
  readonly domain: string;
  readonly findings: readonly RemoteFinding[];
  readonly verdict: Verdict;
}

/**
 * The wire shape into the one the renderer takes.
 *
 * `code` is the only cast, and it is the honest kind: the wire carries a string
 * and the type is a union of the codes this build knows. An API newer than the
 * CLI can name one that is not in the union, which is exactly why `summaryOf`
 * falls back to printing the code rather than indexing into nothing.
 */
function rehydrate(payload: RemoteResult): Renderable {
  const finding = (entry: RemoteFinding): Finding =>
    ({
      code: entry.code as DiagnosisCode,
      evidence: entry.evidence,
      severity: entry.severity,
    }) as Finding;

  return {
    checks: payload.checks.map((outcome) => ({
      findings: outcome.findings.map(finding),
      kind: outcome.kind,
      lookups: outcome.lookups.map((lookup) => ({
        name: lookup.name,
        outcome: { status: lookup.status },
        purpose: lookup.purpose,
        type: lookup.type,
      })),
      verdict: outcome.verdict,
    })),
    domain: payload.domain,
    findings: payload.findings.map(finding),
    verdict: payload.verdict,
  };
}

async function remote(
  input: Input,
  context: Context,
  domain: string,
  records: {
    cnames: readonly { label: string; target: string }[];
    ownership: readonly { label?: string; token: string }[];
  }
): Promise<number> {
  const selectors = input.list("selector");
  const only = input.list("only");
  const caaIssuer = input.text("caa-issuer");
  const spfInclude = input.text("spf-include");

  const result = await apiRequest<RemoteResult>({
    apiUrl: context.apiUrl,
    body: {
      domain,
      ...(only.length === 0 ? {} : { checks: only }),
      ...(caaIssuer === undefined ? {} : { caaIssuer }),
      ...(records.cnames.length === 0 ? {} : { cnames: records.cnames }),
      ...(selectors.length === 0 ? {} : { dkimSelectors: selectors }),
      ...(input.bool("receives-mail") ? { expectsMail: true } : {}),
      ...(records.ownership.length === 0
        ? {}
        : { ownership: records.ownership }),
      ...(spfInclude === undefined ? {} : { spfInclude }),
    },
    method: "POST",
    path: "/v1/checks",
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "the check could not be run"
    );
  }

  return present(rehydrate(result.body.data), input, context.json);
}

async function local(
  input: Input,
  context: Context,
  domain: string,
  records: {
    cnames: readonly { label: string; target: string }[];
    ownership: readonly { label?: string; token: string }[];
  }
): Promise<number> {
  const given = input.text("resolver");
  const resolver =
    given === undefined ? systemResolver() : parseResolver(given);

  if (typeof resolver === "string") {
    return usage(resolver);
  }

  const result = await runChecks({
    domain,
    profile: profileFor(input, records),
    resolver: {
      budgetMs: BUDGET_MS,
      maxLookups: MAX_LOOKUPS,
      recursionDesired: true,
      target: resolver,
      timeoutMs: TIMEOUT_MS,
    },
  });

  return present(result, input, context.json);
}

async function run(input: Input, context: Context): Promise<number> {
  const domain = normaliseDomain(input.needPositional());

  /**
   * A uuid is a registered domain's id, and re-checking one is a different
   * operation: it writes state, spends the per-tenant check budget, and can fire
   * a `domain.failed` webhook — which for our customers means paging theirs. So
   * this points at the command that does it rather than doing it, and nothing
   * goes over the wire either way.
   */
  if (looksLikeId(domain)) {
    process.stderr.write(
      `propgate: that looks like a domain id, not a domain name.\nDid you mean \`propgate domains check ${domain}\`?\n`
    );

    return EXIT_USAGE;
  }

  const records = recordsFor(input);

  if (!records.ok) {
    return usage(records.message);
  }

  const empty = unfeedable(input, records);

  if (empty !== undefined) {
    return usage(empty);
  }

  const wantsRemote = input.bool("remote");

  if (wantsRemote && input.text("resolver") !== undefined) {
    return usage(
      "--resolver has no meaning with --remote; the API queries its own resolvers"
    );
  }

  if (!wantsRemote && context.apiUrlGiven) {
    // Silently ignoring it would let someone believe they had pointed this at a
    // local stack when they had run a local resolution the whole time.
    return usage("--api-url only applies with --remote");
  }

  return wantsRemote
    ? await remote(input, context, domain, records)
    : await local(input, context, domain, records);
}

const TWO_LABELS = /^[^.]+(\.[^.]+)+$/;

export const checkCommand: Command = {
  authenticated: false,
  examples: [
    "propgate check example.com --only spf,dkim --selector k1",
    "propgate check example.com --remote",
  ],
  fields: [
    {
      describe: "A DKIM selector to check. Repeatable.",
      flag: "selector",
      kind: "string",
      placeholder: "name",
      prompt: "Which DKIM selector?",
      repeatable: true,
      required: false,
    },
    {
      describe: "An include: token that must authorise this domain.",
      flag: "spf-include",
      kind: "string",
      placeholder: "name",
      prompt: "Which include: token must authorise this domain?",
      required: false,
    },
    {
      describe: "A certificate authority that must be authorised.",
      flag: "caa-issuer",
      kind: "string",
      placeholder: "ca",
      prompt: "Which certificate authority must be authorised?",
      required: false,
    },
    {
      describe: "An ownership token that must be published.",
      flag: "token",
      kind: "string",
      placeholder: "value",
      prompt: "Which ownership token must be published?",
      required: false,
    },
    {
      describe:
        "The name the token goes at, e.g. _pg-challenge. The apex by default.",
      flag: "token-at",
      kind: "string",
      placeholder: "label",
      prompt: "At which name?",
      required: false,
    },
    {
      describe:
        "An alias that must point at a target, as label=target. Repeatable.",
      flag: "cname",
      kind: "string",
      placeholder: "label=target",
      prompt: "Which alias, as label=target?",
      repeatable: true,
      required: false,
    },
    {
      describe:
        "This domain should receive mail, so undeliverable mail is a problem. Unstated by default.",
      flag: "receives-mail",
      kind: "boolean",
      prompt: "Should this domain receive mail?",
      required: false,
    },
    {
      choices: CHECK_KINDS.map((kind) => ({ value: kind })),
      describe: "Only these checks.",
      flag: "only",
      kind: "multiselect",
      prompt: "Which checks?",
      required: false,
    },
    {
      describe:
        "Resolver to query, as address or address:port. Defaults to the system resolver.",
      flag: "resolver",
      kind: "string",
      placeholder: "addr",
      prompt: "Which resolver?",
      required: false,
    },
    {
      describe: "Print every DNS query behind the answer.",
      flag: "trace",
      kind: "boolean",
      prompt: "Show every query?",
      required: false,
    },
    {
      describe:
        "Ask the propgate API instead of resolving here. Needs no account.",
      flag: "remote",
      kind: "boolean",
      prompt: "Run this against the propgate API?",
      required: false,
    },
  ],
  networked: true,
  path: ["check"],
  positional: {
    describe: "The domain to check.",
    name: "domain",
    prompt: "Which domain?",
    required: true,
    validate: (value) => {
      const trimmed = value.trim().replace(TRAILING_DOT, "").toLowerCase();

      if (looksLikeId(trimmed)) {
        return;
      }

      return TWO_LABELS.test(trimmed)
        ? undefined
        : `"${value}" is not a domain name`;
    },
  },
  run,
  summary:
    "Diagnose a domain's DNS. Resolves locally by default and needs no account.",
};
