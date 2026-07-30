// biome-ignore-all lint/performance/noBarrelFile: intentional package entry point

export type { DiagnosisDefinition, DiagnosisSeverity } from "./diagnosis/codes";
export {
  DIAGNOSIS_REGISTRY,
  DIAGNOSIS_SEVERITIES,
  DiagnosisCode,
  NOT_LOCALLY_REPRODUCIBLE,
} from "./diagnosis/codes";
export type {
  AddressRewrite,
  ResolverOptions,
  RootHint,
  ServerAddress,
  Transport,
} from "./types";
export { DEFAULT_DNS_PORT, resolvePort } from "./types";
