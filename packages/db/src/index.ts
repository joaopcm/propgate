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
} from "./queries/domains";
export type { MintedKey } from "./queries/onboard";
export { mintTenantKey } from "./queries/onboard";
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
export type {
  DomainResult,
  DomainState,
  RequirementResult as StoredRequirementResult,
  StoredLookup,
  StoredVerdict,
} from "./schema/domains";
export { domains } from "./schema/domains";
export type {
  ProfileDefinition,
  ProfileRequirement,
} from "./schema/profiles";
export { profiles } from "./schema/profiles";
export { tenants } from "./schema/tenants";
// A test helper on the entry point, deliberately: the package is private and
// never published, and every consumer with a Postgres-backed spec needs the
// same one line between tests.
export { truncateAll } from "./test/truncate";
