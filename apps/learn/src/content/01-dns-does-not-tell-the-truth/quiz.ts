import { fixtureCodeQuestion, severityQuestion } from "@/lib/quiz/derived";
import type { Question } from "@/lib/quiz/types";

const AUTHORED: readonly Question[] = [
  {
    correct: 1,
    explanation:
      "NODATA is NOERROR with an empty answer section and a SOA in authority: the name exists, the type does not. NXDOMAIN is a distinct response code meaning no such name. The remedies differ: NODATA usually means something else is already configured at that name, and a CNAME cannot legally coexist with other types.",
    id: "unit1:nodata",
    options: [
      "NODATA is response code 3 and NXDOMAIN is response code 0",
      "NODATA is NOERROR with no answer records; the name exists but the type does not",
      "They are two names for the same response",
      "NODATA only occurs in signed zones",
    ],
    prompt: "What distinguishes NODATA from NXDOMAIN?",
    source: "packages/dns-fixtures/zones/unsigned/nodata.test.zone",
  },
  {
    correct: 3,
    explanation:
      "RFC 2308 §5 makes the negative cache TTL the lesser of the SOA MINIMUM field and the SOA record's own TTL. Reading MINIMUM alone is the classic bug: on negcache-low.test it would say an hour when the answer is five minutes, which is long enough for a customer to conclude their fix did not work.",
    id: "unit1:negative-cache",
    options: [
      "The SOA MINIMUM field",
      "The zone's $TTL directive",
      "The greater of the SOA MINIMUM and the SOA record's TTL",
      "The lesser of the SOA MINIMUM and the SOA record's own TTL",
    ],
    prompt: "How long may a resolver cache a negative answer, per RFC 2308?",
    source: "packages/dns-fixtures/zones/unsigned/negcache-low.test.zone",
  },
  {
    correct: 0,
    explanation:
      "Probing a label nobody would configure is the behavioural test: if a random name answers too, the specific record was never added. In a signed zone there is also an authoritative signal: the RRSIG's Labels field is smaller than the answer owner's label count, because the signature was made over the wildcard name.",
    id: "unit1:wildcard-detect",
    options: [
      "Query a label nobody would configure and see whether it answers too",
      "Check whether the TTL is unusually low",
      "Query over TCP instead of UDP",
      "Compare the answer against the zone's SOA serial",
    ],
    prompt:
      "Without DNSSEC, how can a verifier tell that an answer was synthesised by a wildcard?",
    source: "packages/dns/src/evaluate/wildcard.ts",
  },
  {
    correct: 2,
    explanation:
      "Providers that resolve the alias when it is saved serve address records in its place, so `dig CNAME` returns nothing at a name the customer configured exactly as instructed. Telling that apart from a wrong host requires resolving the target you issued and comparing addresses.",
    id: "unit1:flattening",
    options: [
      "The customer used the wrong record type",
      "The resolver stripped the CNAME because it was too long",
      "The provider resolved the alias at save time and published address records instead",
      "CNAME records are not queryable over UDP",
    ],
    prompt:
      "A customer adds the CNAME you asked for, and a CNAME query at that name returns an empty answer. What most likely happened?",
    source: "packages/dns-fixtures/zones/unsigned/cname.test.zone",
  },
  {
    correct: 1,
    explanation:
      "The customer added your record beside the one their previous vendor left behind rather than replacing it. Resolvers hand out the whole set, so some requests reach you and some do not. An overlap test ('is our address among them?') passes this configuration, which is why the comparison has to be a subset test.",
    id: "unit1:partial-subset",
    options: [
      "An overlap test, because any matching address proves the record was added",
      "A subset test, because a stranger's address alongside yours sends some traffic elsewhere",
      "An exact string comparison of the record text",
      "A comparison of TTLs across both records",
    ],
    prompt:
      "A name carries your issued target's address and a stranger's address side by side. Which comparison catches it?",
    source: "packages/dns/src/evaluate/cname.ts",
  },
  {
    correct: 0,
    explanation:
      "dig retries over TCP when it sees TC and prints the retried answer, so the flag never appears. `+ignore` tells it to report the UDP response as received. Without it, a truncation bug is invisible from the command line.",
    id: "unit1:dig-ignore",
    options: [
      "`+ignore`, because dig silently retries over TCP and prints the retried answer",
      "`+tcp`, because TCP responses carry the flag",
      "`+dnssec`, because the flag is only set in signed zones",
      "`+short`, because the flags line is hidden by default",
    ],
    prompt:
      "Which dig flag do you need to actually observe a truncated UDP response?",
    source: "TESTING.md",
  },
  {
    correct: 2,
    explanation:
      "Insecure is an unsigned zone whose lack of a DS record is itself proven: it resolves everywhere and nothing is wrong. Bogus is a signed zone whose signatures do not verify, so validating resolvers return SERVFAIL while non-validating ones answer normally. Reporting one as the other is the false alarm that makes monitoring worse than nothing.",
    id: "unit1:insecure-vs-bogus",
    options: [
      "Insecure zones return SERVFAIL and bogus zones return NXDOMAIN",
      "Both return SERVFAIL, but bogus zones also fail over TCP",
      "Insecure resolves everywhere and nothing is broken; bogus returns SERVFAIL to validating resolvers only",
      "Insecure means the DS record is wrong; bogus means the zone is unsigned",
    ],
    prompt:
      "What is the difference between a DNSSEC-insecure zone and a bogus one?",
    source: "packages/dns-fixtures/zones/unsigned/insecure-island.test.zone",
  },
  {
    correct: 1,
    explanation:
      "The permissive tier iterates without validating, so a bogus zone answers there and SERVFAILs on the validating tier. A SERVFAIL on its own proves only that something is broken; the differential between the two tiers proves the signature is what broke it.",
    id: "unit1:two-resolvers",
    options: [
      "To measure how much slower validation is",
      "So the difference between the two proves it was the signature that failed, not something else",
      "Because bogus zones cannot be served authoritatively",
      "To avoid caching between test runs",
    ],
    prompt:
      "Why does the fixture tier run both a validating and a non-validating resolver?",
    source: "packages/dns-fixtures/src/manifest.ts",
  },
];

export const QUESTIONS: readonly Question[] = [
  ...AUTHORED,
  fixtureCodeQuestion("appended.test", "PROVIDER_APPENDED_ZONE_NAME"),
  fixtureCodeQuestion("wildcard.test", "WILDCARD_FALSE_POSITIVE"),
  fixtureCodeQuestion("nodata.test", "NODATA_NOT_NXDOMAIN"),
  fixtureCodeQuestion("blocked.test", "TCP_SILENTLY_BLOCKED"),
  severityQuestion("NEGATIVE_CACHE_LIKELY"),
  severityQuestion("DNSSEC_BOGUS"),
];
