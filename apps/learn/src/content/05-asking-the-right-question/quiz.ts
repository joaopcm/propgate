import type { Question } from "@/lib/quiz/types";

export const QUESTIONS: readonly Question[] = [
  {
    correct: 2,
    explanation:
      "A null MX is correct on a send-only domain and means every message bounces on one that receives mail. Nothing in DNS distinguishes them, so the caller has to say — which is what expectsMail on the profile is for.",
    id: "unit5:why-profile",
    options: [
      "Because DNS providers format records differently",
      "Because the resolver needs to know which vantage point to use",
      "Because the same records are correct or broken depending on what the domain is for, and DNS cannot say which",
      "Because profiles are how API keys are scoped",
    ],
    prompt: "Why does a verifier need to be told what a domain is for?",
    source: "packages/dns/src/check/profile.ts",
  },
  {
    correct: 0,
    explanation:
      "Anything absent from a profile's checks produces no outcome at all, not a green one. A dashboard showing eight ticks for a domain that was only asked about two is lying about what was verified.",
    id: "unit5:unasked",
    options: [
      "No DKIM outcome at all — the check was not asked, which is different from passing",
      "A passing DKIM outcome, since nothing was found to be wrong",
      "An indeterminate DKIM outcome",
      "A failing DKIM outcome, since no key was found",
    ],
    prompt:
      "A profile does not list `dkim` among its checks. What appears in the result?",
    source: "packages/dns/src/check/run.ts",
  },
  {
    correct: 1,
    explanation:
      "A DKIM key is issued per domain but the field holding it was on the profile, which is a versioned template many domains pin to. Asserting 'this domain publishes the key we issued it' therefore cost one profile version per domain — at ten thousand domains, versioning stops meaning anything.",
    id: "unit5:expectations-moved",
    options: [
      "Profiles could not be serialised to JSON",
      "A per-domain value on a versioned template costs one profile version per domain",
      "The resolver could not read values from the profile",
      "Expected values made profile lookups too slow",
    ],
    prompt:
      "Expected values originally lived on the profile and had to move to the domain. What was the problem?",
    source: "docs/DESIGN.md",
  },
  {
    correct: 3,
    explanation:
      "A value the profile did not defer is ignored rather than honoured, so nothing a domain sends can widen what it is checked against. A value the profile asked for and did not get makes the domain indeterminate — the absence of an answer, not the absence of a problem.",
    id: "unit5:expectation-rules",
    options: [
      "Ignored, and the domain passes",
      "Honoured, and the check is widened to include it",
      "Rejected with a 500, since the profile is inconsistent",
      "Ignored; and a value the profile did ask for and did not get makes the domain indeterminate",
    ],
    prompt:
      "A domain supplies an expectation for a field the profile never asked for. What happens?",
    source: "apps/api/src/profiles/expectations.ts",
  },
  {
    correct: 2,
    explanation:
      "The definition is fetched by key after the body is parsed, so a schema cannot know which fields are valid. Worse, a validator that strips unknown keys would silently drop a typo like expectedPublickey, leaving the domain monitored against no expectation at all — the exact failure the mechanism exists to prevent.",
    id: "unit5:not-a-schema",
    options: [
      "Because the values are encrypted at rest",
      "Because schemas cannot express optional fields",
      "Because the profile is not known when the body is parsed, and a validator that strips unknown keys would silently swallow a typo",
      "Because the check has to happen inside a transaction",
    ],
    prompt:
      "Why can validating a domain's expectations not be done with a schema on the request body?",
    source: "apps/api/src/profiles/expectations.ts",
  },
  {
    correct: 0,
    explanation:
      "All three are properties of the zone. Asking them at a label either means nothing or asks the same question twice — a subdomain nobody delegated has no NS records, which is a failure no customer can act on.",
    id: "unit5:not-repeatable",
    options: [
      "delegation, dmarc and caa, because all three are properties of the zone",
      "spf, mx and dkim, because each has only one correct answer",
      "ownership and cname, because their values are opaque",
      "None; every check kind may repeat",
    ],
    prompt: "Which check kinds are deliberately not repeatable, and why?",
    source: "packages/dns/src/check/profile.ts",
  },
  {
    correct: 1,
    explanation:
      "Two outcomes land under one key, attribution can take only one, and the second requirement is reported against the first's result. If the first token is published and the second is not, the domain reads verified for a token nobody ever published.",
    id: "unit5:collision",
    options: [
      "The second requirement is silently dropped from the result",
      "Both are attributed the first one's outcome, so a domain can read verified for a token nobody published",
      "The check runs twice and the results are merged",
      "The profile is rejected at read time",
    ],
    prompt:
      "Two requirements in one profile resolve to the same discriminator. What was the original failure?",
    source: "apps/api/src/profiles/compile.ts",
  },
  {
    correct: 3,
    explanation:
      "rejectDefinition claims discriminators at profile-write time, but only the ones written as literals — a deferred discriminator has no value yet, so uniqueness is not decidable there. It becomes decidable when a domain supplies its expectations, which is where the collision check has to run.",
    id: "unit5:collision-when",
    options: [
      "Because profile writes are not transactional",
      "Because the resolver does not run at write time",
      "Because two profiles can share a requirement key",
      "Because a deferred discriminator has no value at profile-write time, so uniqueness is not yet decidable",
    ],
    prompt:
      "Uniqueness of discriminators is already checked when a profile is written. Why was that not enough?",
    source: "apps/api/src/profiles/compile.ts",
  },
  {
    correct: 2,
    explanation:
      "The order is pass < warn < indeterminate < fail. Indeterminate beats warn because 'we could not tell' means the check did not run, so anything could be behind it. It loses to fail because a failure actually observed is more actionable than uncertainty about the rest.",
    id: "unit5:verdict-order",
    options: [
      "pass < warn < fail < indeterminate",
      "pass < indeterminate < warn < fail",
      "pass < warn < indeterminate < fail",
      "indeterminate < pass < warn < fail",
    ],
    prompt: "What is the ordering used to take the worst of several verdicts?",
    source: "packages/dns/src/evaluate/types.ts",
  },
  {
    correct: 1,
    explanation:
      "Collapsing indeterminate into fail produces false alarms; collapsing it into pass produces false confidence. Preserving it end to end is what lets a socket timeout stay distinguishable from a real failure all the way to a webhook payload.",
    id: "unit5:indeterminate-why",
    options: [
      "It is a transient state that resolves on retry",
      "Collapsing it into fail produces false alarms and into pass produces false confidence",
      "It exists only for checks that were skipped",
      "It is how rate-limited checks are reported",
    ],
    prompt: "Why is `indeterminate` a verdict rather than an error?",
    source: "packages/dns/src/evaluate/types.ts",
  },
  {
    correct: 0,
    explanation:
      "A shared context would have been simpler until attributing a finding to a check meant slicing an array by index, which stops working the moment anything runs in parallel — and they do run in parallel, because an interactive check's wall clock should be the slowest evaluator rather than the sum of all of them.",
    id: "unit5:concurrent",
    options: [
      "Each check gets its own context, so findings stay attributable when they run in parallel",
      "They share one context, so the lookup budget is enforced globally",
      "They run sequentially, so findings arrive in a stable order",
      "Each check gets its own process, for isolation",
    ],
    prompt:
      "The eight evaluators run concurrently. What does each one get, and why?",
    source: "packages/dns/src/check/run.ts",
  },
];
