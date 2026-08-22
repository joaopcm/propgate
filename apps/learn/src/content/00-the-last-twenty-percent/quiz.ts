import type { Question } from "@/lib/quiz/types";

export const QUESTIONS: readonly Question[] = [
  {
    correct: 1,
    explanation:
      "The doubled name is the single most common support ticket in this space. A provider whose UI expects a name relative to the zone appends the zone again, so the record lands at selector1._domainkey.acme.com.acme.com and the name you queried does not exist at all.",
    id: "unit0:appended",
    options: [
      "The provider rejected the record as too long",
      "The provider appended the zone name again, so the record is one zone deeper than expected",
      "The record is there and the resolver cached an older answer",
      "The provider lowercased the base64 payload",
    ],
    prompt:
      "A customer swears they pasted `selector1._domainkey.acme.com` into their DNS provider, and that exact name returns NXDOMAIN. What is the most likely explanation?",
    source: "packages/dns-fixtures/zones/unsigned/appended.test.zone",
  },
  {
    correct: 0,
    explanation:
      "A wildcard answers for every name in the zone, so a check that asks only 'did the lookup return something?' passes for a customer who added nothing. Detection is behavioural: probe a label nobody would configure, and if that answers too, the specific record was never added.",
    id: "unit0:wildcard",
    options: [
      "It marks domains as verified when nothing was configured",
      "It makes every lookup time out",
      "It causes the answer to be truncated over UDP",
      "It prevents DKIM keys from being parsed",
    ],
    prompt:
      "Why is a `*.example.com TXT` record dangerous for a naive verifier?",
    source: "packages/dns-fixtures/zones/unsigned/wildcard.test.zone",
  },
  {
    correct: 2,
    explanation:
      "Nothing is being logged for its own sake. The current state is updated in place and history is appended only when a value actually changed, because recording every check result at ten thousand domains is roughly 360,000 rows a day and turns a $20 infrastructure bill into a $400 one.",
    id: "unit0:store-changes",
    options: [
      "Because check results are not interesting to customers",
      "Because Postgres cannot handle that many inserts",
      "Because logging every result costs an order of magnitude more in storage for information nobody reads",
      "Because a change is easier to sign than an observation",
    ],
    prompt:
      "The rule is 'store changes, never observations'. What is the stated reason?",
    source: "docs/DESIGN.md",
  },
  {
    correct: 1,
    explanation:
      "A mocked resolver returns whatever you thought the answer was when you wrote the mock. The bugs a diagnosis taxonomy exists to catch (mangled splits, wildcard synthesis, truncation, bogus DNSSEC) live exactly in the gap between what you believed and what servers do.",
    id: "unit0:never-mock",
    options: [
      "Mocks are slower than real queries",
      "A mock agrees with whatever the author already believed, which is where the bugs are",
      "Mocking DNS violates the RFCs",
      "Real servers are needed to measure latency",
    ],
    prompt: "What is the argument against mocking DNS in tests?",
    source: ".claude/CLAUDE.md",
  },
  {
    correct: 0,
    explanation:
      "Consumers write switch statements over the codes, so a rename breaks their integration silently: their default branch starts catching a case they used to handle. That constraint is the reason a code cannot be added without a fixture proving it, or a written reason no local fixture can produce it.",
    id: "unit0:codes-contract",
    options: [
      "Renaming or removing a code is a breaking change for consumers",
      "Codes must be unique across all customers",
      "Codes cannot contain underscores",
      "Every code needs its own database column",
    ],
    prompt:
      "Diagnosis codes are described as a public contract. What follows from that?",
    source: "packages/dns/src/diagnosis/codes.ts",
  },
  {
    correct: 2,
    explanation:
      "The failure mode is a false alarm reaching a real person. One resolver having a bad second must not be able to produce a failure notification on its own, because a product that pages your customers' customers for nothing is worse than a product that does not exist.",
    id: "unit0:hysteresis-why",
    options: [
      "To reduce the number of DNS queries",
      "To keep the database schema simple",
      "Because a false alarm reaching a customer is worse than a delayed true one",
      "Because DNS providers rate-limit repeated queries",
    ],
    prompt: "Why does regression detection need hysteresis?",
    source: "apps/api/src/domains/hysteresis.ts",
  },
];
