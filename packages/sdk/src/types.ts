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

export interface Lookup {
  readonly name: string;
  readonly purpose: string;
  readonly server: string;
  readonly status: string;
  readonly type: number;
}

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

export interface Check {
  readonly checks: readonly CheckOutcome[];
  readonly domain: string;
  readonly elapsedMs: number;
  readonly findings: readonly Finding[];
  readonly object: "check";
  readonly verdict: Verdict;
}

export interface RequirementResult {
  readonly findings: readonly {
    readonly code: DiagnosisCode;
    readonly expected?: string;
    readonly name?: string;
    readonly observed?: string;
  }[];
  readonly key: string;
  readonly satisfied: boolean;
  readonly verdict: Verdict;
}

export type DomainExpectations = Readonly<
  Record<string, Readonly<Record<string, string>>>
>;

export interface Domain {
  readonly createdAt: string;
  readonly externalId: string | null;
  readonly id: string;
  readonly lastCheckedAt: string | null;
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

export interface DomainDetail extends Domain {
  readonly expectations: DomainExpectations | null;
  readonly expectationsFingerprint: string | null;
}

export interface RecordChange {
  readonly current: string | null;
  readonly object: "record_change";
  readonly observedAt: string;
  readonly previous: string | null;
  readonly requirementKey: string;
}

export type PerDomainField =
  | "caaIssuer"
  | "expectedPublicKey"
  | "include"
  | "label"
  | "selector"
  | "target"
  | "token";

export interface ProfileRequirement {
  readonly caaIssuer?: string;
  readonly check: CheckKind;
  readonly expectedPublicKey?: string;
  readonly expectsMail?: boolean;
  readonly include?: string;
  readonly key: string;
  readonly label?: string;
  readonly requiredPerDomain?: readonly PerDomainField[];
  readonly selector?: string;
  readonly target?: string;
  readonly token?: string;
}

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
  readonly events: readonly WebhookEvent[];
  readonly id: string;
  readonly object: "webhook";
  readonly url: string;
}

export interface CreatedWebhook extends Webhook {
  readonly secret?: string;
}

export interface WebhookSecret {
  readonly id: string;
  readonly object: "webhook_secret";
  readonly secret: string;
}

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
  readonly lastError: string | null;
  readonly object: "webhook_delivery";
  readonly payload: WebhookPayload;
  readonly status: DeliveryStatus;
}

export interface ApiKey {
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly id: string;
  readonly lastUsedAt: string | null;
  readonly name: string;
  readonly object: "api_key";
  readonly prefix: string;
  readonly revoked: boolean;
  readonly revokedAt: string | null;
}

export interface CreatedApiKey extends ApiKey {
  readonly key: string;
}

export interface Member {
  readonly createdAt: string;
  readonly email: string;
  readonly id: string;
  readonly object: "member";
}

export interface PageMeta {
  readonly nextCursor: string | null;
}
