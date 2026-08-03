// biome-ignore-all lint/performance/noBarrelFile: intentional package entry point

export type {
  ConsensusOptions,
  ConsensusResult,
  VantageResult,
} from "./check/consensus";
export { runChecksAcrossVantagePoints } from "./check/consensus";
export type { CheckKind, DkimSelector, DomainProfile } from "./check/profile";
export {
  CHECK_KINDS,
  dkimSelectorName,
  fullMail,
  sendingOnly,
  webOnly,
} from "./check/profile";
export type {
  CheckOutcome,
  CheckResult,
  DkimSelectorOutcome,
  RunOptions,
} from "./check/run";
export { outcomeFor, runChecks } from "./check/run";
export type {
  Proof,
  Requirement,
  RequirementStatus,
} from "./conformance/requirements";
export { REQUIREMENTS, RFC_TITLES } from "./conformance/requirements";
export type {
  ConformanceSummary,
  RfcCoverage,
} from "./conformance/summary";
export {
  coverageByRfc,
  percentage,
  summary,
} from "./conformance/summary";
export type { DiagnosisDefinition, DiagnosisSeverity } from "./diagnosis/codes";
export {
  DIAGNOSIS_REGISTRY,
  DIAGNOSIS_SEVERITIES,
  DiagnosisCode,
  NOT_LOCALLY_REPRODUCIBLE,
} from "./diagnosis/codes";
export type { CaaCheck, CaaDiscovery } from "./evaluate/caa";
export { caaClimbPath, evaluateCaa } from "./evaluate/caa";
export type { CaaDecision, CaaIssuer, CaaPolicy } from "./evaluate/caa-record";
export {
  decideIssuance,
  isDenyAll,
  parseCaaIssuer,
  parseCaaPolicy,
} from "./evaluate/caa-record";
export type { EvaluationContextOptions } from "./evaluate/context";
export { createEvaluationContext, EvaluationContext } from "./evaluate/context";
export type { DelegationCheck } from "./evaluate/delegation";
export { evaluateDelegation, parentOf } from "./evaluate/delegation";
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
export type { DmarcCheck, DmarcDiscovery } from "./evaluate/dmarc";
export { dmarcRecordName, evaluateDmarc } from "./evaluate/dmarc";
export type {
  DmarcAlignment,
  DmarcParseResult,
  DmarcPolicy,
  DmarcRecord,
  DmarcReportUri,
} from "./evaluate/dmarc-record";
export {
  effectivePolicy,
  looksLikeDmarc,
  parseDmarcRecord,
} from "./evaluate/dmarc-record";
export type { MxCheck } from "./evaluate/mx";
export { evaluateMx } from "./evaluate/mx";
export type { SpfCheck } from "./evaluate/spf";
export { evaluateSpf } from "./evaluate/spf";
export type { IpAddress, IpFamily } from "./evaluate/spf-ip";
export {
  cidrContains,
  fullPrefix,
  parseIpAddress,
} from "./evaluate/spf-ip";
export type { MacroContext, MacroExpansion } from "./evaluate/spf-macro";
export { expandMacros, validateMacroString } from "./evaluate/spf-macro";
export type {
  SpfMechanism,
  SpfMechanismName,
  SpfModifier,
  SpfParse,
  SpfQualifier,
  SpfRecord,
  SpfTerm,
} from "./evaluate/spf-record";
export {
  containsMacro,
  countsAsLookup,
  directLookupCost,
  looksLikeSpf,
  parseSpfRecord,
  SPF_MECHANISMS,
  SPF_QUALIFIERS,
} from "./evaluate/spf-record";
export type {
  EvaluationResult,
  Evidence,
  Finding,
  Lookup,
  Verdict,
} from "./evaluate/types";
export { verdictFromFindings, worstVerdict } from "./evaluate/types";
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
  RdataCNAME,
  RdataDNSKEY,
  RdataDS,
  RdataMX,
  RdataName,
  RdataNS,
  RdataNSEC,
  RdataNSEC3,
  RdataOPT,
  RdataPTR,
  RdataRRSIG,
  RdataSOA,
  RdataTXT,
  RdataUnknown,
} from "./wire/rdata";
