import type {
  CheckKind,
  DiagnosisCode,
  DiagnosisSeverity,
  Evidence,
  Verdict,
} from "@propgate/dns";

export type {
  CheckKind,
  DiagnosisCode,
  DiagnosisSeverity,
  Evidence,
  Verdict,
} from "@propgate/dns";

/**
 * Every shape the API returns, as the API returns it.
 *
 * Written against the serialisers in `apps/api/src/routes/*.ts` rather than
 * against the database rows behind them, because the wire is what a customer
 * sees. Timestamps are ISO 8601 strings and not `Date`, for the same reason:
 * this is the JSON that arrived, and quietly reviving some fields into objects
 * makes `JSON.stringify(domain)` produce something different from what came in.
 *
 * The taxonomy types come from `@propgate/dns`, which is the package that
 * defines them. A hand-copied union of diagnosis codes is a union that drifts,
 * and the codes are a public contract — invariant 7.
 */

export type DomainState =
  | "degraded"
  | "failed"
  | "pending"
  | "verified"
  | "verifying";

export type WebhookEvent =
  | "domain.degraded"
  | "domain.failed"
  | "domain.recovered"
  | "domain.verified";

export type DeliveryStatus = "delivered" | "failed" | "pending";

/** One DNS query a check made, and why. The derivation behind a verdict. */
export interface Lookup {
  readonly name: string;
  readonly purpose: string;
  /** `address:port` of the server that answered. */
  readonly server: string;
  readonly status: string;
  /** The RR type as a number, e.g. 16 for TXT. */
  readonly type: number;
}

/**
 * A finding with the taxonomy folded in.
 *
 * `slug` and `summary` travel with the code so a dashboard can render something
 * a human reads, and link to the docs page for it, without shipping a copy of
 * the registry.
 */
export interface Finding {
  readonly code: DiagnosisCode;
  readonly evidence: Evidence;
  readonly severity: DiagnosisSeverity;
  readonly slug: string;
  readonly summary: string;
}

export interface CheckOutcome {
  readonly findings: readonly Finding[];
  readonly kind: CheckKind;
  readonly lookups: readonly Lookup[];
  readonly verdict: Verdict;
}

/** What `checks.run` answers: everything propgate knows about one domain. */
export interface Check {
  readonly checks: readonly CheckOutcome[];
  readonly domain: string;
  readonly elapsedMs: number;
  readonly findings: readonly Finding[];
  readonly object: "check";
  readonly verdict: Verdict;
}

/** One requirement's outcome, as stored on the domain. */
export interface RequirementResult {
  readonly findings: readonly {
    readonly code: DiagnosisCode;
    readonly expected?: string;
    /** The DNS name the finding is about, when it has one. */
    readonly name?: string;
    readonly observed?: string;
  }[];
  readonly key: string;
  readonly satisfied: boolean;
  readonly verdict: Verdict;
}

/** A domain's own values, keyed by requirement key and then by field. */
export type DomainExpectations = Readonly<
  Record<string, Readonly<Record<string, string>>>
>;

/**
 * A domain as the list returns it.
 *
 * `requirements`, `requirementsMet` and `requirementsTotal` are null until the
 * first check — deliberately, and not an empty pass: a domain nobody has looked
 * at yet has no requirements met, rather than zero unmet.
 */
export interface Domain {
  readonly createdAt: string;
  readonly externalId: string | null;
  readonly id: string;
  readonly lastCheckedAt: string | null;
  /**
   * Every query the last check made.
   *
   * Present on `get` and `check`, absent from the list — a page of two hundred
   * domains would be 4.4 times larger for a field no list renders — and absent
   * from `create` and `update`, which answer before anything has been looked up.
   */
  readonly lookups?: readonly Lookup[] | null;
  readonly name: string;
  readonly object: "domain";
  readonly profileVersionId: string;
  readonly requirements: readonly RequirementResult[] | null;
  readonly requirementsMet: number | null;
  readonly requirementsTotal: number | null;
  readonly state: DomainState;
  readonly verdict: Verdict | null;
}

/**
 * One domain, with the fields the list omits.
 *
 * `expectationsFingerprint` describes what the *last check* compared, which is
 * the question worth asking after a rotation: has anything looked at the new
 * value yet?
 */
export interface DomainDetail extends Domain {
  readonly expectations: DomainExpectations | null;
  readonly expectationsFingerprint: string | null;
}

/**
 * One observed change to one requirement's records.
 *
 * Appended only when a value actually differs — invariant 3 — so two identical
 * checks add nothing. `previous` is null on the first observation.
 */
export interface RecordChange {
  readonly current: string | null;
  readonly object: "record_change";
  readonly observedAt: string;
  readonly previous: string | null;
  readonly requirementKey: string;
}

/** Fields a profile may defer to the domain that pins it. */
export type PerDomainField =
  | "caaIssuer"
  | "expectedPublicKey"
  | "include"
  | "label"
  | "selector"
  | "target"
  | "token";

/**
 * One requirement of a tenant's record set.
 *
 * `key` is what results are reported against, so it is stable across profile
 * versions in a way a check kind is not — two DKIM selectors are two
 * requirements.
 */
export interface ProfileRequirement {
  readonly caaIssuer?: string;
  readonly check: CheckKind;
  readonly expectedPublicKey?: string;
  readonly expectsMail?: boolean;
  readonly include?: string;
  readonly key: string;
  /** The label the record goes at, e.g. `_pg-challenge`, `track` or `send`. */
  readonly label?: string;
  /**
   * Fields this requirement takes from each domain instead of from here.
   *
   * A field named here must not also carry a literal value, and a domain
   * registered against the profile must supply it — both are refused at write
   * time rather than discovered as a permanently `indeterminate` domain.
   */
  readonly requiredPerDomain?: readonly PerDomainField[];
  readonly selector?: string;
  /** The alias target, e.g. `acme.track.propgate.com`. */
  readonly target?: string;
  /** The ownership token, compared byte for byte. */
  readonly token?: string;
}

/**
 * A profile version.
 *
 * `id` is the version, `key` is the name. Editing a profile writes a new version
 * rather than changing the old one, because domains pin the version they were
 * registered against.
 */
export interface Profile {
  readonly id: string;
  readonly key: string;
  readonly object: "profile";
  readonly requirements: readonly ProfileRequirement[];
  readonly version: number;
}

export interface Webhook {
  readonly createdAt: string;
  readonly disabled: boolean;
  /** Empty means every event. */
  readonly events: readonly WebhookEvent[];
  readonly id: string;
  readonly object: "webhook";
  readonly url: string;
}

/**
 * A newly created webhook, whose signing secret is readable exactly once.
 *
 * Absent when the call matched an endpoint that already existed: the stored
 * secret is kept to sign with and is not ours to hand back, so an idempotent
 * retry is not a way to read a secret somebody else set up. `meta.created` says
 * which happened.
 */
export interface CreatedWebhook extends Webhook {
  readonly secret?: string;
}

export interface WebhookSecret {
  readonly id: string;
  readonly object: "webhook_secret";
  readonly secret: string;
}

/**
 * What a delivery attempt carries, `snake_case` on the wire.
 *
 * The same body the endpoint receives and verifies the signature over, so a
 * consumer's handler and this type describe one shape.
 */
export interface WebhookPayload {
  readonly created_at: string;
  readonly data: {
    readonly domain: string;
    readonly external_id: string | null;
    readonly id: string;
    readonly previous_state: DomainState;
    readonly reason: string;
    readonly state: DomainState;
  };
  readonly type: WebhookEvent;
}

export interface WebhookDelivery {
  readonly attempts: number;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
  readonly domainId: string;
  readonly event: WebhookEvent;
  readonly id: string;
  /** Why a dead-lettered delivery failed. Null while pending and once delivered. */
  readonly lastError: string | null;
  readonly object: "webhook_delivery";
  readonly payload: WebhookPayload;
  readonly status: DeliveryStatus;
}

export interface ApiKey {
  readonly createdAt: string;
  /** Who made it, by address, or null when nobody is on record. */
  readonly createdBy: string | null;
  readonly id: string;
  readonly lastUsedAt: string | null;
  readonly name: string;
  readonly object: "api_key";
  /** The prefix, never the key. Only a hash of the key is stored. */
  readonly prefix: string;
  readonly revoked: boolean;
  readonly revokedAt: string | null;
}

/** A new key, and the only time its secret is ever readable. */
export interface CreatedApiKey extends ApiKey {
  readonly key: string;
}

export interface Member {
  readonly createdAt: string;
  readonly email: string;
  readonly id: string;
  readonly object: "member";
}

/** `meta` on the two cursor-paginated lists. Null `nextCursor` ends the walk. */
export interface PageMeta {
  readonly nextCursor: string | null;
}
