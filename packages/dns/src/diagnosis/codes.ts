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
  /**
   * Authoritative answers disagree across vantage points.
   *
   * Reproduced by the `split.test` fixture pair — the same name served
   * differently by dns-auth and dns-divergent. Real GeoDNS and anycast are still
   * out of reach from one host; see TESTING.md.
   */
  ANSWER_DIVERGES_BY_VANTAGE_POINT: "ANSWER_DIVERGES_BY_VANTAGE_POINT",
  /** An unrecognised property with the critical bit, which blocks all issuance. */
  CAA_CRITICAL_UNKNOWN_PROPERTY: "CAA_CRITICAL_UNKNOWN_PROPERTY",
  /** issue ";" — no CA may issue at all. */
  CAA_ISSUANCE_DENIED: "CAA_ISSUANCE_DENIED",
  /** The CA we need is not among those authorised. */
  CAA_ISSUER_NOT_AUTHORIZED: "CAA_ISSUER_NOT_AUTHORIZED",
  /** The policy governing this name is published on an ancestor, not here. */
  CAA_POLICY_FROM_ANCESTOR: "CAA_POLICY_FROM_ANCESTOR",

  // --- CAA ---
  /** No CAA anywhere up the tree: any CA may issue. */
  CAA_UNRESTRICTED: "CAA_UNRESTRICTED",
  /** issuewild forbids the wildcard certificate being requested. */
  CAA_WILDCARD_DENIED: "CAA_WILDCARD_DENIED",

  // --- CNAME ---
  /** Nothing at all at the name the alias was meant to go at. */
  CNAME_RECORD_MISSING: "CNAME_RECORD_MISSING",
  /** Something is published here and it does not point at the issued target. */
  CNAME_TARGET_MISMATCH: "CNAME_TARGET_MISMATCH",
  /** Some addresses here are the target's and some are somebody else's. */
  CNAME_TARGET_PARTIAL: "CNAME_TARGET_PARTIAL",
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
  /** A report address at another domain that has not authorised receiving them. */
  DMARC_EXTERNAL_REPORT_UNAUTHORIZED: "DMARC_EXTERNAL_REPORT_UNAUTHORIZED",
  /** More than one DMARC record, which RFC 7489 treats as no policy at all. */
  DMARC_MULTIPLE_RECORDS: "DMARC_MULTIPLE_RECORDS",
  /** Policy inherited from the organizational domain rather than published here. */
  DMARC_POLICY_INHERITED: "DMARC_POLICY_INHERITED",
  /** p=none: reports only, nothing is enforced. */
  DMARC_POLICY_NONE: "DMARC_POLICY_NONE",
  /** pct< 100: the policy applies to only some messages. */
  DMARC_POLICY_PARTIAL: "DMARC_POLICY_PARTIAL",
  /** A v=DMARC1 record exists but does not parse. */
  DMARC_RECORD_MALFORMED: "DMARC_RECORD_MALFORMED",

  // --- DMARC ---
  /** No DMARC policy at the domain or its organizational domain. */
  DMARC_RECORD_MISSING: "DMARC_RECORD_MISSING",
  /** A rua/ruf entry that is not a usable URI. */
  DMARC_REPORT_URI_INVALID: "DMARC_REPORT_URI_INVALID",
  /** Signatures failed validation; validating resolvers see nothing at all. */
  DNSSEC_BOGUS: "DNSSEC_BOGUS",
  /** Signed parent, unsigned delegation, no DS — resolves, but unsigned. */
  DNSSEC_INSECURE_ISLAND: "DNSSEC_INSECURE_ISLAND",
  /** More than one TXT RR where the record type permits exactly one. */
  MULTIPLE_DKIM_RECORDS: "MULTIPLE_DKIM_RECORDS",
  /** No MX, so mail is delivered to the address record. */
  MX_IMPLICIT_A: "MX_IMPLICIT_A",
  /** The domain is expected to receive mail and nothing can deliver to it. */
  MX_MAIL_NOT_ACCEPTED: "MX_MAIL_NOT_ACCEPTED",
  /** A null MX: the domain states that it accepts no mail. */
  MX_NULL: "MX_NULL",
  /** A null MX alongside ordinary exchanges. */
  MX_NULL_WITH_OTHER_RECORDS: "MX_NULL_WITH_OTHER_RECORDS",
  /** No MX records at all. */
  MX_RECORDS_MISSING: "MX_RECORDS_MISSING",
  /** An MX points at an alias, which RFC 2181 forbids. */
  MX_TARGET_IS_CNAME: "MX_TARGET_IS_CNAME",
  /** An MX holds an address where a name belongs. */
  MX_TARGET_IS_IP_LITERAL: "MX_TARGET_IS_IP_LITERAL",
  /** A mail exchange has no address. */
  MX_TARGET_UNRESOLVABLE: "MX_TARGET_UNRESOLVABLE",
  /** NXDOMAIN whose authority SOA implies a long negative cache. */
  NEGATIVE_CACHE_LIKELY: "NEGATIVE_CACHE_LIKELY",
  /** Name exists but has no record of the queried type. Not NXDOMAIN. */
  NODATA_NOT_NXDOMAIN: "NODATA_NOT_NXDOMAIN",
  /** No delegated nameserver answered at all. */
  NS_ALL_UNREACHABLE: "NS_ALL_UNREACHABLE",
  /** A delegated nameserver is not authoritative for the delegated zone. */
  NS_DELEGATION_LAME: "NS_DELEGATION_LAME",
  /** The parent's delegation and the zone's own NS records differ. */
  NS_PARENT_CHILD_MISMATCH: "NS_PARENT_CHILD_MISMATCH",
  /** No delegation at the parent and no NS records at the zone. */
  NS_RECORDS_MISSING: "NS_RECORDS_MISSING",
  /** Authoritative servers disagree on the SOA serial. */
  NS_SERIAL_MISMATCH: "NS_SERIAL_MISMATCH",
  /** Only one nameserver, which is a single point of failure. */
  NS_SINGLE_NAMESERVER: "NS_SINGLE_NAMESERVER",
  /** A delegated nameserver did not answer. */
  NS_UNREACHABLE: "NS_UNREACHABLE",

  // --- Ownership ---
  /** Text records at the name, none of them the token we issued. */
  OWNERSHIP_TOKEN_MISMATCH: "OWNERSHIP_TOKEN_MISMATCH",
  /** No text record at the name at all. */
  OWNERSHIP_TOKEN_MISSING: "OWNERSHIP_TOKEN_MISSING",
  /** Record exists at `<name>.<zone>.<zone>` — the provider appended the zone. */
  PROVIDER_APPENDED_ZONE_NAME: "PROVIDER_APPENDED_ZONE_NAME",
  /** A CNAME was expected but an A/AAAA was observed at the same address. */
  PROVIDER_FLATTENED_CNAME: "PROVIDER_FLATTENED_CNAME",
  /** Records in one RRset carry different TTLs, so the set expires piecemeal. */
  RRSET_TTL_MISMATCH: "RRSET_TTL_MISMATCH",

  // --- SPF ---
  /** No all mechanism, so the result for an unlisted sender is neutral. */
  SPF_ALL_MISSING: "SPF_ALL_MISSING",
  /** ?all states no opinion, so the record protects nothing. */
  SPF_ALL_NEUTRAL: "SPF_ALL_NEUTRAL",
  /** +all authorises every host on the internet. */
  SPF_ALL_PASS: "SPF_ALL_PASS",
  /** An include: chain returns to a domain it already visited. */
  SPF_INCLUDE_LOOP: "SPF_INCLUDE_LOOP",
  /** An include: or redirect= target publishes no SPF record. */
  SPF_INCLUDE_UNRESOLVABLE: "SPF_INCLUDE_UNRESOLVABLE",
  /** The record authorises this sending address. */
  SPF_IP_AUTHORIZED: "SPF_IP_AUTHORIZED",
  /** The record states no opinion about this address. */
  SPF_IP_NEUTRAL: "SPF_IP_NEUTRAL",
  /** The record rejects this sending address. */
  SPF_IP_NOT_AUTHORIZED: "SPF_IP_NOT_AUTHORIZED",
  /** The record marks this address as probably unauthorised. */
  SPF_IP_SOFTFAIL: "SPF_IP_SOFTFAIL",
  /** A term depends on the connection, so the address cannot be decided. */
  SPF_IP_UNDETERMINED: "SPF_IP_UNDETERMINED",
  /** More than ten DNS lookups, so receivers return permerror. */
  SPF_LOOKUP_LIMIT_EXCEEDED: "SPF_LOOKUP_LIMIT_EXCEEDED",
  /** Close enough to the ten-lookup limit that one more service breaks it. */
  SPF_LOOKUP_LIMIT_NEAR: "SPF_LOOKUP_LIMIT_NEAR",
  /** A term contains a macro that depends on the connection. */
  SPF_MACRO_NOT_EVALUATED: "SPF_MACRO_NOT_EVALUATED",
  /** More than one SPF record, which RFC 7208 makes a permanent error. */
  SPF_MULTIPLE_RECORDS: "SPF_MULTIPLE_RECORDS",
  /** An mx mechanism expands to more than ten names. */
  SPF_MX_LIMIT_EXCEEDED: "SPF_MX_LIMIT_EXCEEDED",
  /** ptr is published, which RFC 7208 says it should not be. */
  SPF_PTR_MECHANISM: "SPF_PTR_MECHANISM",
  /** The record does not parse, so receivers return permerror. */
  SPF_RECORD_MALFORMED: "SPF_RECORD_MALFORMED",
  /** No SPF record at all. */
  SPF_RECORD_MISSING: "SPF_RECORD_MISSING",
  /** redirect= alongside an all mechanism, so it never runs. */
  SPF_REDIRECT_IGNORED: "SPF_REDIRECT_IGNORED",
  /** The expected sending source is not in the expanded record. */
  SPF_SOURCE_NOT_AUTHORIZED: "SPF_SOURCE_NOT_AUTHORIZED",
  /** A lookup during expansion failed temporarily. */
  SPF_TEMPORARY_FAILURE: "SPF_TEMPORARY_FAILURE",
  /** Mechanisms after all, which never run. */
  SPF_TERMS_AFTER_ALL: "SPF_TERMS_AFTER_ALL",
  /** A term resolves to nothing while still costing a lookup. */
  SPF_VOID_LOOKUP: "SPF_VOID_LOOKUP",
  /** More than two terms resolve to nothing. */
  SPF_VOID_LOOKUP_LIMIT_EXCEEDED: "SPF_VOID_LOOKUP_LIMIT_EXCEEDED",
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
  CAA_CRITICAL_UNKNOWN_PROPERTY: {
    code: DiagnosisCode.CAA_CRITICAL_UNKNOWN_PROPERTY,
    severity: "error",
    slug: "caa-critical-unknown-property",
    summary:
      "This domain publishes a CAA property marked critical that authorities do not understand, which blocks all issuance.",
  },
  CAA_ISSUANCE_DENIED: {
    code: DiagnosisCode.CAA_ISSUANCE_DENIED,
    severity: "error",
    slug: "caa-issuance-denied",
    summary:
      "This domain's CAA policy forbids every certificate authority from issuing.",
  },
  CAA_ISSUER_NOT_AUTHORIZED: {
    code: DiagnosisCode.CAA_ISSUER_NOT_AUTHORIZED,
    severity: "error",
    slug: "caa-issuer-not-authorized",
    summary:
      "The certificate authority we use is not listed in this domain's CAA policy, so it cannot issue a certificate.",
  },
  CAA_POLICY_FROM_ANCESTOR: {
    code: DiagnosisCode.CAA_POLICY_FROM_ANCESTOR,
    severity: "info",
    slug: "caa-policy-from-ancestor",
    summary:
      "The CAA policy for this name is published on a parent domain, so changing it may not be within your control.",
  },
  CAA_UNRESTRICTED: {
    code: DiagnosisCode.CAA_UNRESTRICTED,
    severity: "info",
    slug: "caa-unrestricted",
    summary:
      "No CAA policy applies to this name, so any certificate authority may issue for it.",
  },
  CAA_WILDCARD_DENIED: {
    code: DiagnosisCode.CAA_WILDCARD_DENIED,
    severity: "error",
    slug: "caa-wildcard-denied",
    summary:
      "This domain's CAA policy forbids wildcard certificates, even though ordinary certificates are allowed.",
  },
  CNAME_RECORD_MISSING: {
    code: DiagnosisCode.CNAME_RECORD_MISSING,
    severity: "error",
    slug: "cname-record-missing",
    summary:
      "Nothing is published at this name, so requests for it never reach the target it was meant to point at.",
  },
  CNAME_TARGET_MISMATCH: {
    code: DiagnosisCode.CNAME_TARGET_MISMATCH,
    severity: "error",
    slug: "cname-target-mismatch",
    summary:
      "This name points somewhere other than the target that was issued for it, so traffic for it does not arrive.",
  },
  CNAME_TARGET_PARTIAL: {
    code: DiagnosisCode.CNAME_TARGET_PARTIAL,
    severity: "error",
    slug: "cname-target-partial",
    summary:
      "Some of the addresses at this name are the right ones and some belong to somewhere else, so only some requests for it arrive.",
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
  DMARC_EXTERNAL_REPORT_UNAUTHORIZED: {
    code: DiagnosisCode.DMARC_EXTERNAL_REPORT_UNAUTHORIZED,
    severity: "error",
    slug: "dmarc-external-report-unauthorized",
    summary:
      "Reports are addressed to another domain that has not authorised receiving them, so they are silently discarded.",
  },
  DMARC_MULTIPLE_RECORDS: {
    code: DiagnosisCode.DMARC_MULTIPLE_RECORDS,
    severity: "error",
    slug: "dmarc-multiple-records",
    summary:
      "More than one DMARC record is published here. Receivers treat that as no policy at all, so remove the extras.",
  },
  DMARC_POLICY_INHERITED: {
    code: DiagnosisCode.DMARC_POLICY_INHERITED,
    severity: "info",
    slug: "dmarc-policy-inherited",
    summary:
      "This subdomain has no DMARC record of its own and inherits the policy published at the organizational domain.",
  },
  DMARC_POLICY_NONE: {
    code: DiagnosisCode.DMARC_POLICY_NONE,
    severity: "warning",
    slug: "dmarc-policy-none",
    summary:
      "The policy is p=none, so failing messages are still delivered. This is a monitoring setting, not protection.",
  },
  DMARC_POLICY_PARTIAL: {
    code: DiagnosisCode.DMARC_POLICY_PARTIAL,
    severity: "warning",
    slug: "dmarc-policy-partial",
    summary:
      "The policy applies to only a percentage of messages, so most failures are still delivered.",
  },
  DMARC_RECORD_MALFORMED: {
    code: DiagnosisCode.DMARC_RECORD_MALFORMED,
    severity: "error",
    slug: "dmarc-record-malformed",
    summary:
      "A DMARC record exists but cannot be read, so receivers will behave as though there is no policy.",
  },
  DMARC_RECORD_MISSING: {
    code: DiagnosisCode.DMARC_RECORD_MISSING,
    severity: "error",
    slug: "dmarc-record-missing",
    summary:
      "No DMARC policy was found for this domain, so receivers have no instructions when a message fails authentication.",
  },
  DMARC_REPORT_URI_INVALID: {
    code: DiagnosisCode.DMARC_REPORT_URI_INVALID,
    severity: "warning",
    slug: "dmarc-report-uri-invalid",
    summary:
      "A report address is not a usable URI, so reports for it will not be sent.",
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
  MX_IMPLICIT_A: {
    code: DiagnosisCode.MX_IMPLICIT_A,
    severity: "info",
    slug: "mx-implicit-a",
    summary:
      "This domain has no MX records, so mail is delivered to whatever runs at its address — usually the web server, and usually by accident.",
  },
  MX_MAIL_NOT_ACCEPTED: {
    code: DiagnosisCode.MX_MAIL_NOT_ACCEPTED,
    severity: "error",
    slug: "mx-mail-not-accepted",
    summary: "Mail sent to this domain cannot be delivered anywhere.",
  },
  MX_NULL: {
    code: DiagnosisCode.MX_NULL,
    severity: "info",
    slug: "mx-null",
    summary:
      "This domain declares that it accepts no mail, which is the correct configuration for a domain that only sends.",
  },
  MX_NULL_WITH_OTHER_RECORDS: {
    code: DiagnosisCode.MX_NULL_WITH_OTHER_RECORDS,
    severity: "error",
    slug: "mx-null-with-other-records",
    summary:
      "This domain publishes both a null MX and real mail exchanges, so whether a message is delivered depends on whose mail server is trying.",
  },
  MX_RECORDS_MISSING: {
    code: DiagnosisCode.MX_RECORDS_MISSING,
    severity: "warning",
    slug: "mx-records-missing",
    summary:
      "This domain publishes no MX records, so senders fall back to its address record.",
  },
  MX_TARGET_IS_CNAME: {
    code: DiagnosisCode.MX_TARGET_IS_CNAME,
    severity: "warning",
    slug: "mx-target-is-cname",
    summary:
      "One of this domain's mail exchanges is an alias rather than a host; most senders follow it and some refuse, which looks like an intermittent fault.",
  },
  MX_TARGET_IS_IP_LITERAL: {
    code: DiagnosisCode.MX_TARGET_IS_IP_LITERAL,
    severity: "error",
    slug: "mx-target-is-ip-literal",
    summary:
      "One of this domain's MX records holds an IP address, which is looked up as a name and resolves to nothing.",
  },
  MX_TARGET_UNRESOLVABLE: {
    code: DiagnosisCode.MX_TARGET_UNRESOLVABLE,
    severity: "error",
    slug: "mx-target-unresolvable",
    summary:
      "One of this domain's mail exchanges has no address, so senders have nowhere to connect.",
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
  NS_ALL_UNREACHABLE: {
    code: DiagnosisCode.NS_ALL_UNREACHABLE,
    severity: "error",
    slug: "ns-all-unreachable",
    summary:
      "None of this domain's nameservers answered, so nothing under this name resolves for anyone.",
  },
  NS_DELEGATION_LAME: {
    code: DiagnosisCode.NS_DELEGATION_LAME,
    severity: "error",
    slug: "ns-delegation-lame",
    summary:
      "A nameserver listed for this domain does not answer for it, so some lookups will fail unpredictably.",
  },
  NS_PARENT_CHILD_MISMATCH: {
    code: DiagnosisCode.NS_PARENT_CHILD_MISMATCH,
    severity: "warning",
    slug: "ns-parent-child-mismatch",
    summary:
      "The nameservers this domain is delegated to are not the same set the zone itself publishes.",
  },
  NS_RECORDS_MISSING: {
    code: DiagnosisCode.NS_RECORDS_MISSING,
    severity: "error",
    slug: "ns-records-missing",
    summary:
      "This domain has no nameservers, so nothing under the name resolves.",
  },
  NS_SERIAL_MISMATCH: {
    code: DiagnosisCode.NS_SERIAL_MISMATCH,
    severity: "warning",
    slug: "ns-serial-mismatch",
    summary:
      "This domain's nameservers hold different versions of the zone, so which answer a customer gets depends on which server they reach.",
  },
  NS_SINGLE_NAMESERVER: {
    code: DiagnosisCode.NS_SINGLE_NAMESERVER,
    severity: "warning",
    slug: "ns-single-nameserver",
    summary:
      "This domain has only one nameserver, so it is one maintenance window away from disappearing.",
  },
  NS_UNREACHABLE: {
    code: DiagnosisCode.NS_UNREACHABLE,
    severity: "warning",
    slug: "ns-unreachable",
    summary:
      "One of this domain's nameservers did not answer; the domain still resolves through the others, which is what makes it easy to miss.",
  },
  OWNERSHIP_TOKEN_MISMATCH: {
    code: DiagnosisCode.OWNERSHIP_TOKEN_MISMATCH,
    severity: "error",
    slug: "ownership-token-mismatch",
    summary:
      "This name publishes text records, but none of them is the verification token that was issued for this domain.",
  },
  OWNERSHIP_TOKEN_MISSING: {
    code: DiagnosisCode.OWNERSHIP_TOKEN_MISSING,
    severity: "error",
    slug: "ownership-token-missing",
    summary:
      "The verification token issued for this domain is not published anywhere at this name, so ownership is unproven.",
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
  RRSET_TTL_MISMATCH: {
    code: DiagnosisCode.RRSET_TTL_MISMATCH,
    severity: "warning",
    slug: "rrset-ttl-mismatch",
    summary:
      "Records that belong together carry different lifetimes, so some will disappear from resolvers before the others.",
  },
  SPF_ALL_MISSING: {
    code: DiagnosisCode.SPF_ALL_MISSING,
    severity: "warning",
    slug: "spf-all-missing",
    summary:
      "This domain's SPF record has no all mechanism, so it neither authorises nor rejects senders it does not list.",
  },
  SPF_ALL_NEUTRAL: {
    code: DiagnosisCode.SPF_ALL_NEUTRAL,
    severity: "warning",
    slug: "spf-all-neutral",
    summary:
      "This domain's SPF record ends in ?all, which tells receivers nothing about senders it does not list.",
  },
  SPF_ALL_PASS: {
    code: DiagnosisCode.SPF_ALL_PASS,
    severity: "error",
    slug: "spf-all-pass",
    summary:
      "This domain's SPF record authorises every host on the internet to send as it, which is worse than publishing no record at all.",
  },
  SPF_INCLUDE_LOOP: {
    code: DiagnosisCode.SPF_INCLUDE_LOOP,
    severity: "error",
    slug: "spf-include-loop",
    summary:
      "This domain's SPF record includes a chain that loops back on itself, so it can never finish evaluating.",
  },
  SPF_INCLUDE_UNRESOLVABLE: {
    code: DiagnosisCode.SPF_INCLUDE_UNRESOLVABLE,
    severity: "error",
    slug: "spf-include-unresolvable",
    summary:
      "This domain's SPF record points at another domain that publishes no SPF record, which makes the whole evaluation a permanent error.",
  },
  SPF_IP_AUTHORIZED: {
    code: DiagnosisCode.SPF_IP_AUTHORIZED,
    severity: "info",
    slug: "spf-ip-authorized",
    summary:
      "This domain's SPF record authorises the sending address that was checked.",
  },
  SPF_IP_NEUTRAL: {
    code: DiagnosisCode.SPF_IP_NEUTRAL,
    severity: "warning",
    slug: "spf-ip-neutral",
    summary:
      "This domain's SPF record says nothing either way about the sending address that was checked, which receivers treat much like no record at all.",
  },
  SPF_IP_NOT_AUTHORIZED: {
    code: DiagnosisCode.SPF_IP_NOT_AUTHORIZED,
    severity: "error",
    slug: "spf-ip-not-authorized",
    summary:
      "This domain's SPF record rejects the sending address that was checked, so receivers that honour it will refuse those messages.",
  },
  SPF_IP_SOFTFAIL: {
    code: DiagnosisCode.SPF_IP_SOFTFAIL,
    severity: "warning",
    slug: "spf-ip-softfail",
    summary:
      "This domain's SPF record marks the sending address that was checked as probably unauthorised; receivers usually accept and flag rather than reject.",
  },
  SPF_IP_UNDETERMINED: {
    code: DiagnosisCode.SPF_IP_UNDETERMINED,
    severity: "warning",
    slug: "spf-ip-undetermined",
    summary:
      "Whether this domain's SPF record authorises the sending address depends on something that is not in DNS, so it cannot be decided from the records alone.",
  },
  SPF_LOOKUP_LIMIT_EXCEEDED: {
    code: DiagnosisCode.SPF_LOOKUP_LIMIT_EXCEEDED,
    severity: "error",
    slug: "spf-lookup-limit-exceeded",
    summary:
      "Checking this domain's SPF record needs more than the ten DNS lookups receivers allow, so SPF fails for every message.",
  },
  SPF_LOOKUP_LIMIT_NEAR: {
    code: DiagnosisCode.SPF_LOOKUP_LIMIT_NEAR,
    severity: "warning",
    slug: "spf-lookup-limit-near",
    summary:
      "This domain's SPF record is close to the ten-lookup limit, so adding one more sending service is likely to break it.",
  },
  SPF_MACRO_NOT_EVALUATED: {
    code: DiagnosisCode.SPF_MACRO_NOT_EVALUATED,
    severity: "info",
    slug: "spf-macro-not-evaluated",
    summary:
      "Part of this domain's SPF record changes for every connection, so it cannot be checked from the published records alone.",
  },
  SPF_MULTIPLE_RECORDS: {
    code: DiagnosisCode.SPF_MULTIPLE_RECORDS,
    severity: "error",
    slug: "spf-multiple-records",
    summary:
      "This domain publishes more than one SPF record, which authorises nothing at all; the two must be merged into one.",
  },
  SPF_MX_LIMIT_EXCEEDED: {
    code: DiagnosisCode.SPF_MX_LIMIT_EXCEEDED,
    severity: "error",
    slug: "spf-mx-limit-exceeded",
    summary:
      "An mx mechanism in this domain's SPF record expands to more names than receivers will follow.",
  },
  SPF_PTR_MECHANISM: {
    code: DiagnosisCode.SPF_PTR_MECHANISM,
    severity: "warning",
    slug: "spf-ptr-mechanism",
    summary:
      "This domain's SPF record uses the ptr mechanism, which is slow, unreliable, and ignored by some receivers.",
  },
  SPF_RECORD_MALFORMED: {
    code: DiagnosisCode.SPF_RECORD_MALFORMED,
    severity: "error",
    slug: "spf-record-malformed",
    summary:
      "This domain's SPF record has a syntax error, so receivers reject it outright rather than reading past the mistake.",
  },
  SPF_RECORD_MISSING: {
    code: DiagnosisCode.SPF_RECORD_MISSING,
    severity: "error",
    slug: "spf-record-missing",
    summary:
      "This domain publishes no SPF record, so receivers have nothing to check a sending host against.",
  },
  SPF_REDIRECT_IGNORED: {
    code: DiagnosisCode.SPF_REDIRECT_IGNORED,
    severity: "warning",
    slug: "spf-redirect-ignored",
    summary:
      "This domain's SPF record has both an all mechanism and a redirect, and the redirect is never reached.",
  },
  SPF_SOURCE_NOT_AUTHORIZED: {
    code: DiagnosisCode.SPF_SOURCE_NOT_AUTHORIZED,
    severity: "error",
    slug: "spf-source-not-authorized",
    summary:
      "This domain's SPF record does not authorise the sending service being set up, so its messages will fail SPF.",
  },
  SPF_TEMPORARY_FAILURE: {
    code: DiagnosisCode.SPF_TEMPORARY_FAILURE,
    severity: "warning",
    slug: "spf-temporary-failure",
    summary:
      "A DNS lookup needed to check this domain's SPF record did not answer, so receivers will defer messages rather than reject them.",
  },
  SPF_TERMS_AFTER_ALL: {
    code: DiagnosisCode.SPF_TERMS_AFTER_ALL,
    severity: "warning",
    slug: "spf-terms-after-all",
    summary:
      "This domain's SPF record lists mechanisms after the all mechanism, where they have no effect.",
  },
  SPF_VOID_LOOKUP: {
    code: DiagnosisCode.SPF_VOID_LOOKUP,
    severity: "warning",
    slug: "spf-void-lookup",
    summary:
      "Part of this domain's SPF record points at a name that does not exist, so it authorises nothing while still counting toward the ten-lookup limit.",
  },
  SPF_VOID_LOOKUP_LIMIT_EXCEEDED: {
    code: DiagnosisCode.SPF_VOID_LOOKUP_LIMIT_EXCEEDED,
    severity: "error",
    slug: "spf-void-lookup-limit-exceeded",
    summary:
      "More than two parts of this domain's SPF record point at names that do not exist, which receivers treat as a permanent error.",
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
  RRSET_TTL_MISMATCH:
    "A zone file cannot express it. Measured: named-checkzone silently rewrites a mismatched TTL to the first one it saw, and nsd-checkzone warns — so a fixture would be normalised before it was served and the test would assert nothing. In the wild it comes from a server assembling an answer from several sources, or a resolver merging cached records. The comparison itself is pure and unit-tested.",
};

/**
 * Codes that are published but that no evaluator can produce yet.
 *
 * A code in the taxonomy with nothing behind it is a promise we do not keep: it
 * is on the docs site, in the API's registry, and a consumer switching on it
 * waits forever. `emission.spec.ts` requires every code to be reported
 * somewhere or listed here with the reason and what it would take.
 *
 * This is deliberately separate from `NOT_LOCALLY_REPRODUCIBLE`, which is about
 * whether a *fixture* can produce a code. A code can be perfectly reproducible
 * and still unreachable because nothing looks for it — which is exactly how
 * nine of these came to be published.
 *
 * Empty, and worth keeping rather than deleting: the last entry was
 * `PROVIDER_FLATTENED_CNAME`, which sat here because telling a flattened alias
 * from a wrong one needs the addresses of the target to compare against and
 * nothing had one. The `cname` evaluator does — the target is the whole point of
 * the check — so it emits it now. The next code published ahead of its evaluator
 * belongs here rather than in a commit message.
 */
export const NOT_YET_EMITTED: Readonly<Partial<Record<DiagnosisCode, string>>> =
  {};
