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
    codes: ["TXT_VALUE_SPLIT_MANGLED", "MULTIPLE_DKIM_RECORDS"],
    reason:
      "Multi-string TXT rejoined with whitespace, with duplicated tag prefixes, split across two RRs, and differing only in base64 case.",
    role: "auth",
    zone: "txt-split.test",
  },
  {
    codes: ["TRUNCATED_FELL_BACK_TO_TCP"],
    reason:
      "A real 2048-bit DKIM key (410 bytes) truncates without EDNS; a 4.4 KB TXT truncates even at an advertised 4096.",
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
];

/** Every code any fixture is expected to produce. */
export function coveredDiagnosisCodes(): ReadonlySet<string> {
  return new Set(FIXTURE_EXPECTATIONS.flatMap((row) => row.codes));
}
