import { env } from "@/env";

/**
 * The client for `POST /v1/checks`.
 *
 * Types are declared here rather than imported from `@propgate/dns`: the web
 * app talks to the API over HTTP and should be constrained by the wire format,
 * not by the resolver's internals. If the two drift, that is a fact worth
 * finding out at the boundary.
 */

export const CHECK_KINDS = [
  "delegation",
  "spf",
  "dkim",
  "dmarc",
  "mx",
  "caa",
] as const;

export type CheckKind = (typeof CHECK_KINDS)[number];

export type Verdict = "pass" | "warn" | "indeterminate" | "fail";

export type Severity = "error" | "warning" | "info";

export interface Evidence {
  readonly detail?: string;
  readonly expected?: string;
  readonly name?: string;
  readonly observed?: string;
}

export interface Finding {
  readonly code: string;
  readonly evidence: Evidence;
  readonly severity: Severity;
  readonly slug: string;
  readonly summary: string;
}

export interface Lookup {
  readonly name: string;
  readonly purpose: string;
  readonly server: string;
  readonly status: string;
  readonly type: number;
}

export interface CheckOutcome {
  readonly findings: readonly Finding[];
  readonly kind: CheckKind;
  readonly lookups: readonly Lookup[];
  readonly verdict: Verdict;
}

export interface CheckResult {
  readonly checks: readonly CheckOutcome[];
  readonly domain: string;
  readonly elapsedMs: number;
  readonly findings: readonly Finding[];
  readonly verdict: Verdict;
}

export interface CheckRequest {
  readonly caaIssuer?: string;
  readonly checks?: readonly CheckKind[];
  readonly dkimSelectors?: readonly string[];
  readonly domain: string;
  readonly expectsMail?: boolean;
  readonly spfInclude?: string;
}

export type CheckResponse =
  | { readonly ok: true; readonly result: CheckResult }
  | { readonly ok: false; readonly message: string };

/** What each check is asking, in the words someone would use out loud. */
export const CHECK_LABELS: Readonly<Record<CheckKind, string>> = {
  caa: "Certificates",
  delegation: "Nameservers",
  dkim: "DKIM",
  dmarc: "DMARC",
  mx: "Mail delivery",
  spf: "SPF",
};

export const CHECK_QUESTIONS: Readonly<Record<CheckKind, string>> = {
  caa: "Which authorities may issue certificates",
  delegation: "Whether every nameserver agrees and answers",
  dkim: "Whether the signing keys are published and usable",
  dmarc: "What receivers should do with a message that fails",
  mx: "Where mail for this domain goes",
  spf: "Which hosts may send as this domain",
};

/**
 * How bad each verdict is, for sorting.
 *
 * `indeterminate` sits above `warn` and below `fail`, matching the resolver:
 * "we could not tell" is more serious than a warning because the check did not
 * run, and less serious than a failure that was actually observed.
 */
const VERDICT_RANK: Readonly<Record<Verdict, number>> = {
  fail: 3,
  indeterminate: 2,
  pass: 0,
  warn: 1,
};

export function rankOf(verdict: Verdict): number {
  return VERDICT_RANK[verdict];
}

/** Worst first, so the thing to fix is at the top and the rest is reference. */
export function byUrgency(a: CheckOutcome, b: CheckOutcome): number {
  return rankOf(b.verdict) - rankOf(a.verdict);
}

/**
 * One line saying what happened, for the summary rail.
 *
 * Counting by severity rather than listing codes: someone who just typed a
 * domain wants to know whether to keep reading.
 */
export function summarise(result: CheckResult): string {
  const errors = result.findings.filter((f) => f.severity === "error").length;
  const warnings = result.findings.filter(
    (f) => f.severity === "warning"
  ).length;

  if (errors > 0) {
    return `${errors} problem${errors === 1 ? "" : "s"} to fix${
      warnings > 0 ? `, ${warnings} to look at` : ""
    }`;
  }

  if (warnings > 0) {
    return `${warnings} thing${warnings === 1 ? "" : "s"} worth looking at`;
  }

  if (result.verdict === "indeterminate") {
    return "some checks could not be completed";
  }

  return "nothing to fix";
}

/** DNS record types, for the trail. Only the ones the evaluators ask for. */
const RECORD_TYPES: Readonly<Record<number, string>> = {
  1: "A",
  2: "NS",
  5: "CNAME",
  6: "SOA",
  15: "MX",
  16: "TXT",
  28: "AAAA",
  257: "CAA",
};

/** Where a finding's own page lives. The slug exists for exactly this. */
export function docsUrlFor(slug: string): string {
  return `${env.NEXT_PUBLIC_DOCS_URL}/taxonomy/${slug}`;
}

export function recordTypeName(type: number): string {
  return RECORD_TYPES[type] ?? String(type);
}

interface Envelope {
  data: CheckResult | null;
  error: { message: string } | null;
}

export async function runCheck(
  request: CheckRequest,
  signal?: AbortSignal
): Promise<CheckResponse> {
  let response: Response;

  try {
    response = await fetch(`${env.NEXT_PUBLIC_API_URL}/v1/checks`, {
      body: JSON.stringify(request),
      headers: { "content-type": "application/json" },
      method: "POST",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    // A network failure is not a verdict about the domain, and must never be
    // rendered as one.
    return { message: "Could not reach the checker.", ok: false };
  }

  const envelope = (await response.json().catch(() => null)) as Envelope | null;

  if (envelope === null) {
    return { message: "The check could not be run.", ok: false };
  }

  if (!response.ok || envelope.data === null) {
    // The API sends a message with every error. A response carrying neither is
    // a bug on our side, not something the caller did, so it gets the neutral
    // sentence rather than a blank one.
    return envelope.error === null
      ? { message: "The check could not be run.", ok: false }
      : { message: envelope.error.message, ok: false };
  }

  return { ok: true, result: envelope.data };
}
