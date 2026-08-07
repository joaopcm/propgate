// biome-ignore-all lint/performance/noBarrelFile: intentional package entry point
export type { Database } from "./client";
export { createDb } from "./client";
export type { GeneratedApiKey } from "./keys";
export { API_KEY_PREFIX, generateApiKey, hashApiKey } from "./keys";
export { runMigrations } from "./migrate";
export type {
  Authenticated,
  AuthFailure,
  AuthOutcome,
} from "./queries/api-keys";
export {
  authenticateApiKey,
  createApiKey,
  revokeApiKey,
} from "./queries/api-keys";
export type {
  DomainListRow,
  DomainPage,
  DomainRow,
  RegisterOutcome,
  TimelineEntry,
} from "./queries/domains";
export {
  deleteDomain,
  domainByExternalId,
  domainById,
  domainByName,
  domainTimeline,
  listDomains,
  registerDomain,
  saveCheck,
  updateDomainConfig,
} from "./queries/domains";
export type { TenantMember } from "./queries/members";
export { listMembersForTenant } from "./queries/members";
export type { Account, MintedKey } from "./queries/onboard";
export { findOrCreateAccountForEmail, mintTenantKey } from "./queries/onboard";
export type { ConsumeOutcome, IssueOutcome } from "./queries/otp";
export {
  consumeCode,
  issueCode,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
} from "./queries/otp";
export type { ProfileVersion } from "./queries/profiles";
export {
  createProfileVersion,
  currentProfileVersion,
  profileVersionById,
} from "./queries/profiles";
export type { Observation } from "./queries/record-changes";
export { recordObservation } from "./queries/record-changes";
export type {
  ApiKeySummary,
  RevokeOutcome,
} from "./queries/revocation";
export {
  activeApiKeyCount,
  apiKeysMatching,
  listApiKeys,
  revokeApiKeyByReference,
} from "./queries/revocation";
export type { TransitionInput } from "./queries/state-transitions";
export {
  domainTransitions,
  recordTransition,
} from "./queries/state-transitions";
export type { ClaimedDomain, ClaimOptions } from "./queries/sweep";
export { claimDueDomains, dueCount } from "./queries/sweep";
export type {
  TenantApiKey,
  TenantRevokeOutcome,
} from "./queries/tenant-keys";
export {
  apiKeyForTenant,
  listApiKeysForTenant,
  revokeApiKeyForTenant,
} from "./queries/tenant-keys";
export type {
  CreateEndpointOutcome,
  DeliveryAttemptContext,
  DeliveryPage,
  DeliveryRow,
  EndpointRow,
} from "./queries/webhooks";
export {
  activeSecrets,
  createEndpoint,
  deleteEndpoint,
  deliveryForAttempt,
  endpointById,
  endpointsForEvent,
  listDeliveries,
  listEndpoints,
  markAttemptFailed,
  markDelivered,
  pendingDeliveries,
  recordDelivery,
  rotateSecret,
  secretsFrom,
  updateEndpoint,
} from "./queries/webhooks";
export type {
  DomainExpectations,
  DomainResult,
  DomainState,
  RequirementResult as StoredRequirementResult,
  StoredLookup,
  StoredVerdict,
} from "./schema/domains";
export { domains } from "./schema/domains";
export { otpCodes } from "./schema/otp-codes";
export type {
  PerDomainField,
  ProfileDefinition,
  ProfileRequirement,
} from "./schema/profiles";
export {
  PER_DOMAIN_FIELDS,
  PER_DOMAIN_FIELDS_BY_CHECK,
  profiles,
} from "./schema/profiles";
export type {
  StoredTransition,
  TransitionEvidence,
} from "./schema/state-transitions";
export { stateTransitions } from "./schema/state-transitions";
export { tenantMembers } from "./schema/tenant-members";
export { tenants } from "./schema/tenants";
export type { DeliveryStatus } from "./schema/webhooks";
export { webhookDeliveries, webhookEndpoints } from "./schema/webhooks";
// A test helper on the entry point, deliberately: the package is private and
// never published, and every consumer with a Postgres-backed spec needs the
// same one line between tests.
export { truncateAll } from "./test/truncate";
