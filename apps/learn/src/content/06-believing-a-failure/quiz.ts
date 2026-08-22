import { fixtureCodeQuestion, severityQuestion } from "@/lib/quiz/derived";
import type { Question } from "@/lib/quiz/types";

const AUTHORED: readonly Question[] = [
  {
    correct: 3,
    explanation:
      "Uncertainty is not evidence of failure and not evidence of health. Resetting would let a domain that alternates failure and unreachability never accumulate consecutive failures, so a genuinely broken domain behind a flaky resolver would be monitored forever and never reported. Incrementing would let our own resolver's bad minute page somebody.",
    id: "unit6:indeterminate-counter",
    options: [
      "It resets to zero, because the check did not fail",
      "It increments, because the check did not succeed",
      "It resets and the domain returns to pending",
      "It is left exactly as it was, and the state does not move",
    ],
    prompt:
      "A check comes back `indeterminate`. What happens to the consecutive-failure counter?",
    source: "apps/api/src/domains/hysteresis.ts",
  },
  {
    correct: 1,
    explanation:
      "Resetting it means failure and unreachability can alternate forever without ever reaching three consecutive failures, so a genuinely broken domain behind a flaky resolver is monitored indefinitely and never reported. It is a bug hiding inside the intuitive choice.",
    id: "unit6:reset-bug",
    options: [
      "The domain would be reported as failed too early",
      "A domain alternating failure and unreachability could never reach the failed threshold",
      "The counter would overflow",
      "Recovered domains would never fire an event",
    ],
    prompt:
      "What specifically goes wrong if an indeterminate check resets the failure counter?",
    source: "apps/api/src/domains/hysteresis.ts",
  },
  {
    correct: 0,
    explanation:
      "degraded means 'this used to work and now does not', so it needs something to have regressed from. Without the guard, a freshly registered domain whose first check finds nothing, and a domain reset to pending after its expectations were rotated, both fire an event claiming something used to work that never did.",
    id: "unit6:degraded-guard",
    options: [
      "Only from verified or degraded, because degraded is a regression and needs something to regress from",
      "From any state, once the threshold is reached",
      "Only from pending, since that is where new domains start",
      "Only from failed, on the way back up",
    ],
    prompt: "From which states can a domain become `degraded`?",
    source: "apps/api/src/domains/hysteresis.ts",
  },
  {
    correct: 2,
    explanation:
      "A strict majority keeps the majority's verdict but raises it to at least warn and attaches a divergence finding. That is the point of three rather than two: one resolver serving a stale answer is outvoted instead of making the whole check uncertain.",
    id: "unit6:majority",
    options: [
      "The check is indeterminate, because the vantage points disagree",
      "The majority verdict passes through untouched",
      "The majority verdict is kept but raised to at least warn, with a divergence finding attached",
      "The strictest of the three verdicts wins",
    ],
    prompt:
      "Two of three vantage points agree and one does not. What is the verdict?",
    source: "packages/dns/src/check/consensus.ts",
  },
  {
    correct: 1,
    explanation:
      "With no strict majority there is nothing to believe, so indeterminate is the honest answer, and indeterminate deliberately moves no state at all.",
    id: "unit6:no-majority",
    options: [
      "The first vantage point's answer is used",
      "The verdict is indeterminate, and no state changes",
      "The worst of the three verdicts is used",
      "The check is retried until a majority emerges",
    ],
    prompt: "Three vantage points give three different answers. What happens?",
    source: "packages/dns/src/check/consensus.ts",
  },
  {
    correct: 3,
    explanation:
      "The signature is the verdict plus the sorted finding codes. Comparing raw records would fire on every healthy domain, because two resolvers legitimately return an RRset in different orders and with different remaining TTLs.",
    id: "unit6:signature",
    options: [
      "The raw records, byte for byte",
      "The record set sorted alphabetically",
      "The response's message ID",
      "The verdict plus the sorted diagnosis codes",
    ],
    prompt: "What is compared to decide whether two vantage points agree?",
    source: "packages/dns/src/check/consensus.ts",
  },
  {
    correct: 0,
    explanation:
      "Resolvers reached from one machine share an egress IP, so they catch cache state, propagation lag and one broken resolver. They cannot see GeoDNS, anycast, or a path that differs by geography: a domain answering differently in Frankfurt than in São Paulo looks identical from there.",
    id: "unit6:vantage-limit",
    options: [
      "GeoDNS and anycast, because the resolvers share an egress IP",
      "Negative caching, because all three caches are cold",
      "Truncation, because resolvers hide the TC bit",
      "DNSSEC state, because only one resolver validates",
    ],
    prompt: "What can three resolvers reached from a single host not detect?",
    source: "packages/dns/src/check/consensus.ts",
  },
  {
    correct: 2,
    explanation:
      "A domain close to SPF's ten-lookup limit works today. Calling that degraded would train people to ignore the state, so warn is treated as a passing check, which makes a diagnosis code's severity a decision about the state machine rather than about presentation.",
    id: "unit6:warn-is-pass",
    options: [
      "As a failure, incrementing the counter",
      "As indeterminate, leaving the counter untouched",
      "As a pass, because a warning describes something that works today",
      "As a pass, but without resetting the counter",
    ],
    prompt: "How does the state machine treat a `warn` verdict?",
    source: "apps/api/src/domains/hysteresis.ts",
  },
  {
    correct: 1,
    explanation:
      "A transition is reported only when the state actually moved, so a domain degraded for a week produces one transition rather than two thousand. Getting the property from 'only emit on a real change' rather than from a separate suppression rule is why there is nothing to forget.",
    id: "unit6:once-per-episode",
    options: [
      "A deduplication window on the webhook queue",
      "Transitions are only recorded when the state actually changed, so events are downstream of a real change",
      "A rate limit on outbound webhooks per domain",
      "A flag on the domain recording whether an event was already sent",
    ],
    prompt:
      "What makes a `domain.degraded` event fire once per episode rather than on every check?",
    source: "apps/api/src/domains/hysteresis.ts",
  },
  {
    correct: 3,
    explanation:
      "For a verified domain nothing can change faster than the TTL, so polling inside it re-reads a cache. Applying the same floor while pending would be actively wrong: a provider serving a one-hour negative TTL would push the first re-check an hour out and make onboarding feel broken.",
    id: "unit6:ttl-floor",
    options: [
      "Every state, since the TTL bounds how fast anything can change",
      "pending and verifying, where the customer is waiting",
      "degraded and failed, where checks are most frequent",
      "verified only, because a one-hour negative TTL would ruin onboarding elsewhere",
    ],
    prompt:
      "To which states does the observed-TTL floor on the check interval apply?",
    source: "apps/api/src/sweep/schedule.ts",
  },
  {
    correct: 0,
    explanation:
      "A number nobody has measured does not need a production override: it needs the measurement. The hysteresis thresholds do get environment overrides, because being wrong there means a false alarm reaching a customer rather than a slightly wasteful poll.",
    id: "unit6:injectable",
    options: [
      "Because an unmeasured number needs a measurement rather than a runtime knob, and changing the policy is a code change",
      "Because environment variables cannot hold numbers",
      "Because the intervals are derived from the TTL at runtime",
      "Because operators would set them too low",
    ],
    prompt:
      "The sweep intervals are injectable but not environment-tunable. Why?",
    source: "apps/api/src/sweep/schedule.ts",
  },
];

export const QUESTIONS: readonly Question[] = [
  ...AUTHORED,
  fixtureCodeQuestion("split.test", "ANSWER_DIVERGES_BY_VANTAGE_POINT"),
  severityQuestion("ANSWER_DIVERGES_BY_VANTAGE_POINT"),
];
