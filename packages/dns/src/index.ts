// biome-ignore-all lint/performance/noBarrelFile: intentional package entry point

export type { DiagnosisDefinition, DiagnosisSeverity } from "./diagnosis/codes";
export {
  DIAGNOSIS_REGISTRY,
  DIAGNOSIS_SEVERITIES,
  DiagnosisCode,
  NOT_LOCALLY_REPRODUCIBLE,
} from "./diagnosis/codes";
export type { EvaluationContextOptions } from "./evaluate/context";
export { createEvaluationContext, EvaluationContext } from "./evaluate/context";
export type { DkimCheck } from "./evaluate/dkim";
export { dkimRecordName, evaluateDkim } from "./evaluate/dkim";
export type {
  DkimKeyResult,
  DkimParseResult,
  DkimRecord,
} from "./evaluate/dkim-record";
export {
  isTestingMode,
  parseDkimKey,
  parseDkimRecord,
} from "./evaluate/dkim-record";
export type {
  EvaluationResult,
  Evidence,
  Finding,
  Lookup,
  Verdict,
} from "./evaluate/types";
export { worstVerdict } from "./evaluate/types";
export type { PslOptions } from "./psl";
export {
  getPublicSuffix,
  getRegistrableDomain,
  isPublicSuffix,
} from "./psl";
export { PSL_UPSTREAM_COMMIT } from "./psl/data";
export { query } from "./transport/query";
export type { QueryOutcome, QuerySpec } from "./transport/types";
export type {
  AddressRewrite,
  ResolverOptions,
  RootHint,
  ServerAddress,
  Transport,
} from "./types";
export { DEFAULT_DNS_PORT, resolvePort } from "./types";
export type { RecordTypeName, RecordTypeValue } from "./wire/constants";
export {
  CLASSIC_UDP_LIMIT,
  DNSSEC_ALGORITHM_NAMES,
  RCODE_NAMES,
  Rcode,
  RECORD_TYPE_NAMES,
  RecordClass,
  RecordType,
  rcodeName,
} from "./wire/constants";
export type { DecodeResult, WireFormatReason } from "./wire/errors";
export { WireFormatError } from "./wire/errors";
export type {
  Flags,
  Message,
  Question,
  ResourceRecord,
} from "./wire/message";
export { decodeMessage, encodeQuery, recordsOfType } from "./wire/message";
export type {
  Rdata,
  RdataA,
  RdataAAAA,
  RdataCAA,
  RdataDNSKEY,
  RdataDS,
  RdataMX,
  RdataName,
  RdataNSEC,
  RdataNSEC3,
  RdataOPT,
  RdataRRSIG,
  RdataSOA,
  RdataTXT,
  RdataUnknown,
} from "./wire/rdata";
