/**
 * What each fixture is for.
 *
 * This table is the join between the zone files and the diagnosis taxonomy. Two
 * consumers read it, which is the point:
 *
 *  - `packages/dns/src/diagnosis/coverage.spec.ts` fails if a diagnosis code is
 *    neither listed here nor explicitly recorded as not locally reproducible.
 *  - `apps/docs` renders the published taxonomy from the same data, so the
 *    documentation and the test matrix cannot drift apart.
 *
 * Adding a fixture means adding a row. Adding a diagnosis code without either a
 * row or a written reason makes the suite red.
 */

export interface FixtureExpectation {
  /** Diagnosis codes this fixture is expected to produce. */
  readonly codes: readonly string[];
  /** Why the fixture exists, in one line. */
  readonly reason: string;
  /** Which server serves it. */
  readonly role: "auth" | "root" | "decoy" | "divergent";
  /** Zone the fixture lives in. */
  readonly zone: string;
}

export const FIXTURE_EXPECTATIONS: readonly FixtureExpectation[] = [
  {
    codes: ["PROVIDER_APPENDED_ZONE_NAME"],
    reason:
      "Record sits at selector1._domainkey.appended.test.appended.test; the correct name is NXDOMAIN.",
    role: "auth",
    zone: "appended.test",
  },
  {
    codes: ["PROVIDER_FLATTENED_CNAME"],
    reason:
      "Stands in for our own infrastructure, so a flattened CNAME can be told apart from a genuinely wrong target by comparing addresses.",
    role: "auth",
    zone: "propgate-fixture.test",
  },
  {
    codes: ["WILDCARD_FALSE_POSITIVE"],
    reason:
      "A wildcard answers every name, so a naive existence check passes for a customer who configured nothing. Behavioural detection path.",
    role: "auth",
    zone: "wildcard.test",
  },
  {
    codes: ["WILDCARD_FALSE_POSITIVE"],
    reason:
      "Same failure, authoritative detection path: RRSIG Labels is smaller than the queried name's label count. Signed with alg 13.",
    role: "auth",
    zone: "wildcard-signed.test",
  },
  {
    codes: [
      "DKIM_RECORD_MISSING",
      "DKIM_RECORD_MALFORMED",
      "DKIM_KEY_UNPARSEABLE",
      "DKIM_KEY_REVOKED",
      "DKIM_KEY_TOO_SHORT",
      "DKIM_KEY_MISMATCH",
      "DKIM_TESTING_MODE",
    ],
    reason:
      "DKIM semantics as distinct from wire-level mangling: revoked (empty p=), a real 512-bit key, testing mode, wrong version, v= not first, unsupported algorithm, and a non-DKIM TXT sharing the selector. Every key is real and parses with node:crypto.",
    role: "auth",
    zone: "dkim.test",
  },
  {
    codes: [
      "DMARC_RECORD_MISSING",
      "DMARC_RECORD_MALFORMED",
      "DMARC_MULTIPLE_RECORDS",
      "DMARC_POLICY_NONE",
      "DMARC_POLICY_PARTIAL",
      "DMARC_POLICY_INHERITED",
      "DMARC_REPORT_URI_INVALID",
    ],
    reason:
      "Policy discovery and semantics. own.dmarc.test publishes its own policy so the exact-name lookup wins; inherit.dmarc.test publishes none so sp= applies. Also multiple records, a policy sharing a name with an unrelated TXT, v= not first, no p=, and an out-of-range pct.",
    role: "auth",
    zone: "dmarc.test",
  },
  {
    codes: ["DMARC_EXTERNAL_REPORT_UNAUTHORIZED"],
    reason:
      "The authorized/unauthorized pair for RFC 7489 §7.1. reports.test publishes dmarc.test._report._dmarc; unauth-reports.test is a real zone that deliberately does not, so the absence is NXDOMAIN rather than an unreachable server — a misconfiguration rather than uncertainty.",
    role: "auth",
    zone: "unauth-reports.test",
  },
  {
    codes: [],
    reason:
      "The authorised counterpart to unauth-reports.test. Without a zone that passes, the unauthorized finding would only prove that something failed.",
    role: "auth",
    zone: "reports.test",
  },
  {
    codes: [
      "CAA_UNRESTRICTED",
      "CAA_POLICY_FROM_ANCESTOR",
      "CAA_ISSUER_NOT_AUTHORIZED",
      "CAA_ISSUANCE_DENIED",
      "CAA_WILDCARD_DENIED",
      "CAA_CRITICAL_UNKNOWN_PROPERTY",
    ],
    reason:
      "Tree climbing and property semantics. deep.nested climbs two labels to the apex; sub publishes its own policy that must not be merged with the apex's; split has different CAs for issue and issuewild; critical carries an unknown property with the critical bit, which blocks issuance despite also naming a CA.",
    role: "auth",
    zone: "caa.test",
  },
  {
    codes: [],
    reason:
      "The climb must cross a zone cut: inner.caa-child.test is separately delegated and publishes no CAA, so the policy at caa-child.test governs it. A resolver that stopped at the delegation boundary would miss the policy entirely.",
    role: "auth",
    zone: "caa-child.test",
  },
  {
    codes: ["TXT_VALUE_SPLIT_MANGLED", "MULTIPLE_DKIM_RECORDS"],
    reason:
      "Multi-string TXT rejoined with whitespace, with duplicated tag prefixes, split across two RRs, and differing only in base64 case.",
    role: "auth",
    zone: "txt-split.test",
  },
  {
    codes: ["TRUNCATED_FELL_BACK_TO_TCP"],
    reason:
      "Both sides of the boundary, measured rather than assumed: a real 2048-bit key is a 483-byte response and must NOT be reported as truncated, while a 4096-bit key exceeds 512 and must be. A 4.4 KB TXT truncates even at an advertised 4096.",
    role: "auth",
    zone: "tcp.test",
  },
  {
    codes: [],
    reason:
      "The DNSSEC control. Without a zone that validates cleanly, a SERVFAIL only proves something broke, not that a signature did.",
    role: "auth",
    zone: "secure.test",
  },
  {
    codes: ["DNSSEC_BOGUS"],
    reason:
      "Both DNSKEY RRSIGs corrupted, so the zone is bogus via the validating tier and fine via the permissive one.",
    role: "auth",
    zone: "bogus-zone.test",
  },
  {
    codes: ["DNSSEC_INSECURE_ISLAND"],
    reason:
      "Unsigned child delegated from the signed parent with no DS. Must read as insecure, never as bogus — the remedies differ completely.",
    role: "auth",
    zone: "insecure-island.test",
  },
  {
    codes: ["NS_DELEGATION_LAME"],
    reason:
      "Delegated to dns-decoy, which is authoritative for decoy.test only and so answers REFUSED immediately.",
    role: "root",
    zone: "lame.test",
  },
  {
    codes: ["NEGATIVE_CACHE_LIKELY"],
    reason:
      "SOA MINIMUM 3600 with a 300s SOA TTL. RFC 2308 says the negative TTL is the smaller of the two; taking MINIMUM alone is the classic bug.",
    role: "auth",
    zone: "negcache-low.test",
  },
  {
    codes: ["NODATA_NOT_NXDOMAIN"],
    reason:
      "A name with an A record but no TXT. NODATA is RCODE 0 with a SOA in authority, not NXDOMAIN, and the fixes differ.",
    role: "auth",
    zone: "nodata.test",
  },
  {
    codes: [],
    reason:
      "Serves different answers from dns-auth, so consensus and hysteresis have something to disagree about. See ANSWER_DIVERGES_BY_VANTAGE_POINT in NOT_LOCALLY_REPRODUCIBLE for what this can and cannot prove.",
    role: "divergent",
    zone: "divergent.test",
  },
  {
    codes: [],
    reason:
      "A multi-label public suffix, which .test cannot model. DMARC is only valid at PSL+1, so _dmarc.example.co.uk counts and _dmarc.co.uk must never be read.",
    role: "auth",
    zone: "example.co.uk",
  },
  {
    codes: [],
    reason:
      "The other public-suffix shape: github.io is itself a suffix, so a naive one-label strip lands on a policy belonging to nobody. Also carries the quoted CAA deny-all.",
    role: "auth",
    zone: "user.github.io",
  },
  {
    codes: [
      "SPF_ALL_MISSING",
      "SPF_ALL_NEUTRAL",
      "SPF_ALL_PASS",
      "SPF_INCLUDE_LOOP",
      "SPF_IP_AUTHORIZED",
      "SPF_IP_NEUTRAL",
      "SPF_IP_NOT_AUTHORIZED",
      "SPF_IP_SOFTFAIL",
      "SPF_IP_UNDETERMINED",
      "SPF_INCLUDE_UNRESOLVABLE",
      "SPF_LOOKUP_LIMIT_EXCEEDED",
      "SPF_LOOKUP_LIMIT_NEAR",
      "SPF_MACRO_NOT_EVALUATED",
      "SPF_MULTIPLE_RECORDS",
      "SPF_MX_LIMIT_EXCEEDED",
      "SPF_PTR_MECHANISM",
      "SPF_RECORD_MALFORMED",
      "SPF_RECORD_MISSING",
      "SPF_REDIRECT_IGNORED",
      "SPF_SOURCE_NOT_AUTHORIZED",
      "SPF_TEMPORARY_FAILURE",
      "SPF_TERMS_AFTER_ALL",
      "SPF_VOID_LOOKUP",
      "SPF_VOID_LOOKUP_LIMIT_EXCEEDED",
    ],
    reason:
      "The ten-lookup and two-void limits of RFC 7208 4.6.4 are spent across a whole include: tree, so neither is visible in any single record. Each name here is sized to land one term either side of a boundary, which is the only way an off-by-one in the accounting shows up as a failure rather than as a plausible number. The address-matching names carry both an A and a AAAA so that `a` can be shown following the client's family, and a /24 so that a matcher ignoring the prefix is caught.",
    role: "auth",
    zone: "spf.test",
  },
];

/** Every code any fixture is expected to produce. */
export function coveredDiagnosisCodes(): ReadonlySet<string> {
  return new Set(FIXTURE_EXPECTATIONS.flatMap((row) => row.codes));
}
