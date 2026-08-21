import {
  fixtureCodeQuestion,
  requirementGapQuestion,
  severityQuestion,
} from "@/lib/quiz/derived";
import type { Question } from "@/lib/quiz/types";

const AUTHORED: readonly Question[] = [
  {
    correct: 2,
    explanation:
      "RFC 7208 §4.6.4 caps DNS-querying terms at ten across the whole evaluation, including everything reached through include: expansion. The terms that spend one are include, a, mx, ptr, exists, and the redirect modifier; ip4, ip6 and all need no query.",
    id: "unit3:ten-lookups",
    options: [
      "Ten per record, so a nested include: tree may use thirty",
      "Ten TXT records at the apex",
      "Ten DNS-querying terms across the entire evaluation, including everything reached through include:",
      "Ten seconds of total DNS query time",
    ],
    prompt: "What exactly does SPF's ten-lookup limit count?",
    source: "packages/dns/src/evaluate/spf.ts",
  },
  {
    correct: 1,
    explanation:
      "ip4, ip6 and all decide without a query. Every other mechanism — include, a, mx, ptr, exists — and the redirect modifier each spend one of the ten.",
    id: "unit3:which-cost",
    options: [
      "include, a, mx and ip4",
      "ip4, ip6 and all",
      "all, exists and redirect",
      "Only include and redirect",
    ],
    prompt: "Which SPF terms cost no DNS lookup?",
    source: "packages/dns/src/evaluate/spf.ts",
  },
  {
    correct: 0,
    explanation:
      "A void lookup is a DNS-querying term that resolves to nothing. RFC 7208 §4.6.4 permits two; the third is a permanent error. Three retired include: terms is a broken record, and reading the record does not reveal it — you have to resolve each term to find out nothing is there.",
    id: "unit3:void-limit",
    options: [
      "Two. The third is a permanent error",
      "Ten, the same as the lookup limit",
      "There is no limit; each simply spends a lookup",
      "One, and a second is a warning",
    ],
    prompt:
      "How many terms may resolve to nothing before the record is a permanent error?",
    source: "packages/dns/src/evaluate/spf.ts",
  },
  {
    correct: 3,
    explanation:
      "A record ending in bare `all` is `+all`, which authorises every host on the internet. That is strictly worse than publishing nothing: it tells receivers that forgeries are legitimate.",
    id: "unit3:default-qualifier",
    options: [
      "It is `-all`, so unlisted senders are rejected",
      "It is `~all`, so unlisted senders are marked",
      "It is `?all`, so the domain has no opinion",
      "It is `+all`, which authorises the entire internet",
    ],
    prompt:
      "A record ends in `all` with no qualifier written. What does that mean?",
    source: "packages/dns-fixtures/zones/unsigned/spf.test.zone",
  },
  {
    correct: 1,
    explanation:
      "RFC 7208 §6.1 says redirect= is ignored entirely when the record contains an all mechanism, because all always matches and evaluation never reaches the modifier. A checker that expands it anyway charges a lookup no receiver spends and reports authorisation from a record no receiver reads.",
    id: "unit3:redirect-ignored",
    options: [
      "The redirect is evaluated first, then -all applies as a fallback",
      "The redirect is ignored entirely, because -all matches first",
      "The record is a permanent error for containing both",
      "Both are evaluated and the stricter result wins",
    ],
    prompt: "What does `v=spf1 -all redirect=example.net` do?",
    source: "packages/dns-fixtures/zones/unsigned/spf.test.zone",
  },
  {
    correct: 2,
    explanation:
      "RFC 7208 §4.5 makes more than one SPF record a permanent error, so the domain authorises nothing. The subtlety is that records not beginning with v=spf1 must be discarded before any are counted — otherwise every domain with a verification token published as TXT is reported as having two.",
    id: "unit3:multiple-records",
    options: [
      "The two records are merged and both sets of mechanisms apply",
      "The first record wins and the second is ignored",
      "It is a permanent error, so the domain authorises nothing",
      "It is a warning, and receivers pick one at random",
    ],
    prompt: "What happens when a domain publishes two `v=spf1` records?",
    source: "packages/dns/src/evaluate/spf-record.ts",
  },
  {
    correct: 0,
    explanation:
      "Macros expand per connection, so exists:%{ir}.%{v}._spf.example.com asks about a different name for every sending address. Without a sender to evaluate against, the honest answer is that the term could not be evaluated — not that it failed.",
    id: "unit3:macro-sender",
    options: [
      "The term is unevaluable, and reporting that is more honest than guessing either way",
      "The term always matches, because the macro expands to an empty string",
      "The term never matches, so the record fails",
      "The record is malformed",
    ],
    prompt:
      "A record uses `exists:%{ir}.%{v}._spf.example.com` and the checker has no specific sending address. What is the correct outcome for that term?",
    source: "packages/dns/src/evaluate/spf-macro.ts",
  },
  {
    correct: 1,
    explanation:
      "The threshold has a receipt: adding one mainstream sending service costs between one and three lookups — the include: term plus whatever its own record spends. A domain with fewer than three spare is one integration away from breaking, which is the moment to say something rather than after the mail stops.",
    id: "unit3:headroom",
    options: [
      "Half the limit, because that is a natural midpoint",
      "Fewer than three spare lookups, because one new sending service costs one to three",
      "Nine, because ten is the failure",
      "It is not warned about, only failed",
    ],
    prompt:
      "At how much remaining headroom is an SPF record worth warning about, and why that number?",
    source: "packages/dns/src/evaluate/spf.ts",
  },
  {
    correct: 2,
    explanation:
      "A receiver stops at the term that would exceed the limit, so a verifier that keeps expanding is measuring something the receiver never sees — and spending queries against somebody else's servers to do it.",
    id: "unit3:never-exceed",
    options: [
      "To keep the check fast",
      "To avoid rate limits",
      "Because a receiver stops there too, so expanding further measures something no receiver sees",
      "Because the eleventh lookup would always be a void lookup",
    ],
    prompt:
      "Why should a verifier never perform the lookup that would exceed the ten-lookup limit?",
    source: "packages/dns/src/evaluate/spf.ts",
  },
];

export const QUESTIONS: readonly Question[] = [
  ...AUTHORED,
  fixtureCodeQuestion("spf.test", "SPF_VOID_LOOKUP_LIMIT_EXCEEDED"),
  fixtureCodeQuestion("spf.test", "SPF_TERMS_AFTER_ALL"),
  severityQuestion("SPF_LOOKUP_LIMIT_NEAR"),
  severityQuestion("SPF_ALL_PASS"),
  requirementGapQuestion(7208),
];
