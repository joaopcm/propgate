// biome-ignore-all lint/performance/noBarrelFile: intentional package entry point

export type { FixtureExpectation } from "./expectations";
export {
  coveredDiagnosisCodes,
  FIXTURE_EXPECTATIONS,
} from "./expectations";
export type { FixtureRole, FixtureServer } from "./manifest";
export {
  CANARY_NAME,
  DNSSEC_BOGUS_ZONE,
  DNSSEC_CONTROL_ZONE,
  FIXTURE_ROLES,
  FIXTURE_ROOT_HINTS,
  FIXTURE_SERVERS,
} from "./manifest";
export {
  assertFixturesFresh,
  assertFixturesReady,
  readCommittedRevision,
} from "./ready";
export type { FixtureTarget } from "./resolver";
export {
  FIXTURE_QUERY_TIMEOUT_MS,
  fixtureResolver,
  fixtureTarget,
  uniqueLabel,
} from "./resolver";
export type { Blackhole } from "./tcp-blackhole";
export { startTcpBlackhole } from "./tcp-blackhole";
