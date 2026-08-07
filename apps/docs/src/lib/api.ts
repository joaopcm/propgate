import type { CheckKind, Verdict } from "@propgate/dns";

/**
 * The API reference, as data.
 *
 * Two of these tables are keyed by a type from `@propgate/dns` rather than by
 * a string: `Record<CheckKind, …>` and `Record<Verdict, …>`. Adding a seventh
 * check kind or a fifth verdict therefore fails `tsc --noEmit`, which CI
 * already runs, rather than quietly shipping a reference that is missing one.
 *
 * That is the same rule the taxonomy pages follow — the published docs and the
 * code cannot disagree, because one is derived from the other.
 */

export interface RequirementType {
  /** What the tenant states, beyond the check name. */
  readonly fields: readonly { readonly name: string; readonly note: string }[];
  readonly repeatable: boolean;
  readonly summary: string;
}

export const REQUIREMENT_TYPES: Record<CheckKind, RequirementType> = {
  caa: {
    fields: [
      {
        name: "caaIssuer",
        note: "Required. The CA that must be authorised, e.g. letsencrypt.org.",
      },
    ],
    repeatable: false,
    summary:
      "The CAA tree authorises a named certificate authority. Rejected without an issuer: the evaluator has nothing to compare against, so the requirement could never be reported on.",
  },
  delegation: {
    fields: [],
    repeatable: false,
    summary:
      "Every nameserver in the delegation answers authoritatively and agrees. Catches lame delegations and stale NS records, which look like intermittent outages to everyone else.",
  },
  dkim: {
    fields: [
      { name: "selector", note: "Required. The label before _domainkey." },
      {
        name: "expectedPublicKey",
        note: "Optional. The key you issued. Supplying it turns “a valid key is published” into “your key is published”, which is what catches a domain that pasted someone else's record.",
      },
    ],
    repeatable: true,
    summary:
      "A selector publishes a valid, usable key. The one requirement type that may appear more than once, because DKIM answers a question per selector rather than per domain.",
  },
  dmarc: {
    fields: [],
    repeatable: false,
    summary:
      "A valid DMARC record is discoverable at the right name. A p=none policy is a warning, not a failure — there is deliberately no way to require a minimum policy, because the evaluator cannot assert one and a requirement nobody can evaluate is a promise this API would not keep.",
  },
  mx: {
    fields: [
      {
        name: "expectsMail",
        note: "Optional, and tri-state. Omit it if you do not know. false asserts the domain receives no mail, which makes a null MX correct rather than a fault.",
      },
    ],
    repeatable: false,
    summary:
      "Mail is deliverable, or correctly declared undeliverable. Whether a null MX is right depends entirely on intent, which no amount of looking at DNS reveals.",
  },
  spf: {
    fields: [
      {
        name: "include",
        note: "Optional. The include: token you publish. Expanded recursively, the way an MTA would, with the RFC 7208 ten-lookup and two-void-lookup limits enforced.",
      },
      {
        name: "ip",
        note: "Optional. A specific sending address to evaluate the record against.",
      },
    ],
    repeatable: false,
    summary:
      "The SPF record authorises your sending infrastructure and is within the RFC limits.",
  },
};

export interface VerdictMeaning {
  readonly effect: string;
  readonly satisfied: string;
  readonly summary: string;
}

export const VERDICTS: Record<Verdict, VerdictMeaning> = {
  fail: {
    effect: "Moves the domain to failed.",
    satisfied: "No",
    summary: "We looked, and the requirement is not met.",
  },
  indeterminate: {
    effect:
      "Changes nothing. The domain keeps whatever state it had, last_checked_at moves, and nothing is appended to the timeline.",
    satisfied: "No — but not a failure either",
    summary:
      "We could not tell. A resolver was unreachable, a query timed out, or an answer could not be validated.",
  },
  pass: {
    effect: "Moves the domain to verified.",
    satisfied: "Yes",
    summary: "The requirement is met with nothing to report.",
  },
  warn: {
    effect: "Moves the domain to verified.",
    satisfied: "Yes",
    summary:
      "The requirement is met, with advice about something that works today. A p=none DMARC policy is the common case.",
  },
};

export interface Endpoint {
  /** The CLI command that reaches it. Every endpoint has one. */
  readonly cli: string;
  readonly method: "DELETE" | "GET" | "PATCH" | "POST";
  readonly path: string;
  readonly summary: string;
}

export const ENDPOINTS: readonly Endpoint[] = [
  {
    cli: "propgate check <domain> --remote",
    method: "POST",
    path: "/v1/checks",
    summary:
      "Diagnose any domain. Public, unauthenticated, rate limited by address. The same engine as the CLI and the web checker.",
  },
  {
    cli: "propgate signup",
    method: "POST",
    path: "/v1/signup",
    summary:
      "Start an account. Sends a six-digit code, valid ten minutes. Always answers the same way, whether or not the address is known.",
  },
  {
    cli: "propgate confirm",
    method: "POST",
    path: "/v1/signup/confirm",
    summary:
      "Confirm the address and receive an API key. The code is single-use; the key is shown once and never again.",
  },
  {
    cli: "propgate keys create <name>",
    method: "POST",
    path: "/v1/api-keys",
    summary:
      "Create an API key. The secret is returned once and never again — only its hash is stored.",
  },
  {
    cli: "propgate keys list",
    method: "GET",
    path: "/v1/api-keys",
    summary:
      "Your keys, oldest first, revoked ones included, each with the address that created it. Prefixes only; no endpoint returns a secret.",
  },
  {
    cli: "propgate keys revoke <prefix|id>",
    method: "DELETE",
    path: "/v1/api-keys/:id",
    summary:
      "Revoke a key. Takes effect on the next request. Revoking your last active key is refused.",
  },
  {
    cli: "propgate members list",
    method: "GET",
    path: "/v1/members",
    summary:
      "Who is on this account. Read-only — a member is added by proving control of a mailbox through signup.",
  },
  {
    cli: "propgate profiles create",
    method: "POST",
    path: "/v1/profiles",
    summary:
      "Create a profile version. Editing a profile writes a new version; it never changes an existing one.",
  },
  {
    cli: "propgate profiles get <key>",
    method: "GET",
    path: "/v1/profiles/:key",
    summary: "The current version of a profile.",
  },
  {
    cli: "propgate domains add <domain>",
    method: "POST",
    path: "/v1/domains",
    summary:
      "Register a domain against a profile. Does not touch DNS. The domain starts pending.",
  },
  {
    cli: "propgate domains check <id>",
    method: "POST",
    path: "/v1/domains/:id/checks",
    summary:
      "Verify the domain now. Runs the checks, updates the state, returns a result per requirement.",
  },
  {
    cli: "propgate domains list",
    method: "GET",
    path: "/v1/domains",
    summary:
      "Your domains, oldest first. Cursor paging, filterable by state and by your own external id.",
  },
  {
    cli: "propgate domains get <id>",
    method: "GET",
    path: "/v1/domains/:id",
    summary:
      "The last known state, per-requirement results, and every lookup behind them.",
  },
  {
    cli: "propgate domains timeline <id>",
    method: "GET",
    path: "/v1/domains/:id/timeline",
    summary:
      "What has changed for this domain, newest first. Appended to only when an observation actually differs.",
  },
  {
    cli: "propgate domains delete <id>",
    method: "DELETE",
    path: "/v1/domains/:id",
    summary: "Stop tracking the domain.",
  },
  {
    cli: "propgate webhooks create",
    method: "POST",
    path: "/v1/webhooks",
    summary:
      "Register an endpoint. Idempotent on the URL; the signing secret is returned only on the call that creates it.",
  },
  {
    cli: "propgate webhooks list",
    method: "GET",
    path: "/v1/webhooks",
    summary: "Your endpoints. An empty events array means every event.",
  },
  {
    cli: "propgate webhooks get <id>",
    method: "GET",
    path: "/v1/webhooks/:id",
    summary: "One endpoint.",
  },
  {
    cli: "propgate webhooks update <id>",
    method: "PATCH",
    path: "/v1/webhooks/:id",
    summary:
      "Change which events an endpoint receives, or disable it. Both fields are optional; omitting both changes nothing.",
  },
  {
    cli: "propgate webhooks delete <id>",
    method: "DELETE",
    path: "/v1/webhooks/:id",
    summary: "Remove an endpoint. Nothing further is delivered to it.",
  },
  {
    cli: "propgate webhooks rotate <id>",
    method: "POST",
    path: "/v1/webhooks/:id/secret",
    summary:
      "Issue a new signing secret. The previous one keeps verifying for a window of up to 168 hours, so a deploy does not have to be instant. Zero expires it immediately.",
  },
  {
    cli: "propgate webhooks deliveries <id>",
    method: "GET",
    path: "/v1/webhooks/:id/deliveries",
    summary:
      "What has been sent to this endpoint, newest first. Cursor paging, filterable by status.",
  },
];
