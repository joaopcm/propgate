/**
 * The diagnosis taxonomy.
 *
 * This is the product. "Record not found" creates a support ticket;
 * PROVIDER_APPENDED_ZONE_NAME deflects one. Codes are a stable public contract:
 * consumers switch on them, so changing or removing one is a breaking change.
 *
 * Phase 0 seeds only the codes the starter fixtures actually exercise, plus the
 * ones documented as not locally reproducible. Phase 1 grows this to ~50
 * alongside the full fixture catalogue. `coverage.spec.ts` enforces that every
 * code here is either produced by a fixture or has a written reason why not, so
 * the taxonomy cannot drift ahead of its tests.
 */

export const DIAGNOSIS_SEVERITIES = ["error", "warning", "info"] as const;

export type DiagnosisSeverity = (typeof DIAGNOSIS_SEVERITIES)[number];

export const DiagnosisCode = {
  // --- Not locally reproducible. See NOT_LOCALLY_REPRODUCIBLE below. ---
  /** Authoritative answers disagree across vantage points. */
  ANSWER_DIVERGES_BY_VANTAGE_POINT: "ANSWER_DIVERGES_BY_VANTAGE_POINT",
  /** A valid key, but not the one the profile expects. */
  DKIM_KEY_MISMATCH: "DKIM_KEY_MISMATCH",
  /** p= is empty, which RFC 6376 defines as revocation. */
  DKIM_KEY_REVOKED: "DKIM_KEY_REVOKED",
  /** Key is valid but shorter than receivers now expect. */
  DKIM_KEY_TOO_SHORT: "DKIM_KEY_TOO_SHORT",
  /** p= parses but is not a usable key. */
  DKIM_KEY_UNPARSEABLE: "DKIM_KEY_UNPARSEABLE",
  /** The record exists but is not a parseable DKIM key record. */
  DKIM_RECORD_MALFORMED: "DKIM_RECORD_MALFORMED",

  // --- DKIM ---
  /** No TXT record at the selector, and no sign of one nearby. */
  DKIM_RECORD_MISSING: "DKIM_RECORD_MISSING",
  /** t=y — receivers must ignore failures, so the key is not yet protecting anything. */
  DKIM_TESTING_MODE: "DKIM_TESTING_MODE",
  /** Signatures failed validation; validating resolvers see nothing at all. */
  DNSSEC_BOGUS: "DNSSEC_BOGUS",
  /** Signed parent, unsigned delegation, no DS — resolves, but unsigned. */
  DNSSEC_INSECURE_ISLAND: "DNSSEC_INSECURE_ISLAND",
  /** More than one TXT RR where the record type permits exactly one. */
  MULTIPLE_DKIM_RECORDS: "MULTIPLE_DKIM_RECORDS",
  /** NXDOMAIN whose authority SOA implies a long negative cache. */
  NEGATIVE_CACHE_LIKELY: "NEGATIVE_CACHE_LIKELY",
  /** Name exists but has no record of the queried type. Not NXDOMAIN. */
  NODATA_NOT_NXDOMAIN: "NODATA_NOT_NXDOMAIN",
  /** A delegated nameserver is not authoritative for the delegated zone. */
  NS_DELEGATION_LAME: "NS_DELEGATION_LAME",
  /** Record exists at `<name>.<zone>.<zone>` — the provider appended the zone. */
  PROVIDER_APPENDED_ZONE_NAME: "PROVIDER_APPENDED_ZONE_NAME",
  /** A CNAME was expected but an A/AAAA was observed at the same address. */
  PROVIDER_FLATTENED_CNAME: "PROVIDER_FLATTENED_CNAME",
  /** A middlebox silently drops TCP/53, so oversized answers never arrive. */
  TCP_SILENTLY_BLOCKED: "TCP_SILENTLY_BLOCKED",
  /** Response was truncated and the TCP retry succeeded. */
  TRUNCATED_FELL_BACK_TO_TCP: "TRUNCATED_FELL_BACK_TO_TCP",
  /** Multi-string TXT reassembled with an unexpected separator. */
  TXT_VALUE_SPLIT_MANGLED: "TXT_VALUE_SPLIT_MANGLED",
  /** A wildcard synthesised the answer; the specific record is absent. */
  WILDCARD_FALSE_POSITIVE: "WILDCARD_FALSE_POSITIVE",
} as const;

export type DiagnosisCode = (typeof DiagnosisCode)[keyof typeof DiagnosisCode];

export interface DiagnosisDefinition {
  readonly code: DiagnosisCode;
  readonly severity: DiagnosisSeverity;
  /** Anchor within the published taxonomy page. */
  readonly slug: string;
  /** Shown to the end user. Plain, specific, and actionable. */
  readonly summary: string;
}

export const DIAGNOSIS_REGISTRY: Readonly<
  Record<DiagnosisCode, DiagnosisDefinition>
> = {
  ANSWER_DIVERGES_BY_VANTAGE_POINT: {
    code: DiagnosisCode.ANSWER_DIVERGES_BY_VANTAGE_POINT,
    severity: "warning",
    slug: "answer-diverges-by-vantage-point",
    summary:
      "Different parts of the internet see different answers for this name, so verification results may be inconsistent.",
  },
  DKIM_KEY_MISMATCH: {
    code: DiagnosisCode.DKIM_KEY_MISMATCH,
    severity: "error",
    slug: "dkim-key-mismatch",
    summary:
      "A valid DKIM key is published here, but it is not the one we issued. It may be left over from another provider.",
  },
  DKIM_KEY_REVOKED: {
    code: DiagnosisCode.DKIM_KEY_REVOKED,
    severity: "error",
    slug: "dkim-key-revoked",
    summary:
      "This DKIM key has been revoked by publishing an empty key. Signatures using this selector will fail.",
  },
  DKIM_KEY_TOO_SHORT: {
    code: DiagnosisCode.DKIM_KEY_TOO_SHORT,
    severity: "warning",
    slug: "dkim-key-too-short",
    summary:
      "This DKIM key is shorter than 1024 bits. Some receivers already refuse keys this small.",
  },
  DKIM_KEY_UNPARSEABLE: {
    code: DiagnosisCode.DKIM_KEY_UNPARSEABLE,
    severity: "error",
    slug: "dkim-key-unparseable",
    summary:
      "The public key in this record cannot be read. It was most likely altered when it was pasted in.",
  },
  DKIM_RECORD_MALFORMED: {
    code: DiagnosisCode.DKIM_RECORD_MALFORMED,
    severity: "error",
    slug: "dkim-record-malformed",
    summary:
      "A record exists at this selector but it is not a valid DKIM key record, so receivers will ignore it.",
  },
  DKIM_RECORD_MISSING: {
    code: DiagnosisCode.DKIM_RECORD_MISSING,
    severity: "error",
    slug: "dkim-record-missing",
    summary:
      "No DKIM record was found at this selector, so messages signed with it cannot be verified.",
  },
  DKIM_TESTING_MODE: {
    code: DiagnosisCode.DKIM_TESTING_MODE,
    severity: "warning",
    slug: "dkim-testing-mode",
    summary:
      "This DKIM record is in testing mode, so receivers are told to ignore signature failures. Remove t=y once you are ready.",
  },
  DNSSEC_BOGUS: {
    code: DiagnosisCode.DNSSEC_BOGUS,
    severity: "error",
    slug: "dnssec-bogus",
    summary:
      "DNSSEC signatures for this domain fail validation, so validating resolvers cannot see any of its records.",
  },
  DNSSEC_INSECURE_ISLAND: {
    code: DiagnosisCode.DNSSEC_INSECURE_ISLAND,
    severity: "warning",
    slug: "dnssec-insecure-island",
    summary:
      "This delegation is unsigned beneath a signed parent, so DNSSEC protection stops here.",
  },
  MULTIPLE_DKIM_RECORDS: {
    code: DiagnosisCode.MULTIPLE_DKIM_RECORDS,
    severity: "error",
    slug: "multiple-dkim-records",
    summary:
      "More than one record exists at this name. Remove the extras so only the correct one remains.",
  },
  NEGATIVE_CACHE_LIKELY: {
    code: DiagnosisCode.NEGATIVE_CACHE_LIKELY,
    severity: "warning",
    slug: "negative-cache-likely",
    summary:
      "This name does not exist yet and the absence may be cached for a while. Wait before re-checking.",
  },
  NODATA_NOT_NXDOMAIN: {
    code: DiagnosisCode.NODATA_NOT_NXDOMAIN,
    severity: "warning",
    slug: "nodata-not-nxdomain",
    summary:
      "The name exists but has no record of the type we need. Something else is configured at this name.",
  },
  NS_DELEGATION_LAME: {
    code: DiagnosisCode.NS_DELEGATION_LAME,
    severity: "error",
    slug: "ns-delegation-lame",
    summary:
      "A nameserver listed for this domain does not answer for it, so some lookups will fail unpredictably.",
  },
  PROVIDER_APPENDED_ZONE_NAME: {
    code: DiagnosisCode.PROVIDER_APPENDED_ZONE_NAME,
    severity: "error",
    slug: "provider-appended-zone-name",
    summary:
      "Your DNS provider added the domain name to the end of the record name. Enter just the part before the domain.",
  },
  PROVIDER_FLATTENED_CNAME: {
    code: DiagnosisCode.PROVIDER_FLATTENED_CNAME,
    severity: "info",
    slug: "provider-flattened-cname",
    summary:
      "Your provider flattens CNAMEs into address records. The record is correct; it just looks different when queried.",
  },
  TCP_SILENTLY_BLOCKED: {
    code: DiagnosisCode.TCP_SILENTLY_BLOCKED,
    severity: "error",
    slug: "tcp-silently-blocked",
    summary:
      "Large answers for this domain never arrive, which usually means something is blocking DNS over TCP.",
  },
  TRUNCATED_FELL_BACK_TO_TCP: {
    code: DiagnosisCode.TRUNCATED_FELL_BACK_TO_TCP,
    severity: "info",
    slug: "truncated-fell-back-to-tcp",
    summary:
      "The record is too large for a single UDP response, so it was retrieved over TCP. This is normal for 2048-bit keys.",
  },
  TXT_VALUE_SPLIT_MANGLED: {
    code: DiagnosisCode.TXT_VALUE_SPLIT_MANGLED,
    severity: "error",
    slug: "txt-value-split-mangled",
    summary:
      "The record was split into chunks and rejoined incorrectly, corrupting the value.",
  },
  WILDCARD_FALSE_POSITIVE: {
    code: DiagnosisCode.WILDCARD_FALSE_POSITIVE,
    severity: "error",
    slug: "wildcard-false-positive",
    summary:
      "A wildcard record is answering for this name, so the specific record was never actually added.",
  },
};

/**
 * Codes that cannot be reproduced against the local fixture harness, each with
 * the reason. `coverage.spec.ts` requires every code to be either fixture-backed
 * or listed here, so "we forgot to write the fixture" and "this genuinely can't
 * be tested locally" can never be confused for one another.
 */
export const NOT_LOCALLY_REPRODUCIBLE: Readonly<
  Partial<Record<DiagnosisCode, string>>
> = {
  ANSWER_DIVERGES_BY_VANTAGE_POINT:
    "Needs genuinely divergent authoritative answers across network locations. The dns-divergent fixture reproduces divergent *answers*, which is what the consensus logic consumes, but real GeoDNS and anycast behaviour is not reproducible locally.",
  TCP_SILENTLY_BLOCKED:
    "Requires a middlebox that drops TCP/53 without an RST. Reproducing it needs NET_ADMIN and an iptables DROP rule inside a bridged container; without that we get ECONNREFUSED, which is a different timing profile. Deferred to Phase 1 as an optional fixture.",
};
