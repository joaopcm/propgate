import { unreproducibleCodeQuestion } from "@/lib/quiz/derived";
import type { Question } from "@/lib/quiz/types";

const AUTHORED: readonly Question[] = [
  {
    correct: 2,
    explanation:
      "Their handled case falls into the default branch. Nothing errors, so the integration quietly gets worse and they find out from their own support queue. That is why a code rename is a breaking change.",
    id: "unit8:rename",
    options: [
      "Their integration throws an unhandled error",
      "The API returns a 400 until they update",
      "Their handled case silently falls into the default branch",
      "Nothing, because codes are only for display",
    ],
    prompt:
      "A consumer switches on diagnosis codes. What happens when one is renamed?",
    source: "packages/dns/src/diagnosis/codes.ts",
  },
  {
    correct: 1,
    explanation:
      "A code with no fixture is a claim nobody can support: it appears on the docs site and in the registry, and a consumer switching on it waits forever for something nothing produces. The guard makes adding a code a deliberate act with a cost.",
    id: "unit8:coverage-guard",
    options: [
      "That every code appears in the documentation",
      "That every code is either produced by a fixture or carries a written reason it cannot be",
      "That no two codes share a severity",
      "That codes are alphabetically ordered",
    ],
    prompt: "What does the diagnosis coverage guard enforce?",
    source: "packages/dns/src/diagnosis/coverage.spec.ts",
  },
  {
    correct: 3,
    explanation:
      "One asks whether a fixture can produce the code. The other asks whether any evaluator emits it. A code can be perfectly reproducible and still unreachable because nothing looks for it — which is how nine codes came to be published ahead of their evaluators.",
    id: "unit8:two-lists",
    options: [
      "They are the same list under two names",
      "One is for warnings and one is for errors",
      "One is for local tests and one is for production",
      "One asks whether a fixture can produce the code; the other asks whether any evaluator emits it",
    ],
    prompt:
      "What is the difference between `NOT_LOCALLY_REPRODUCIBLE` and `NOT_YET_EMITTED`?",
    source: "packages/dns/src/diagnosis/codes.ts",
  },
  {
    correct: 0,
    explanation:
      "The entry records that named-checkzone silently rewrites a mismatched TTL to the first one it saw and nsd-checkzone warns, so a fixture would be normalised before being served and the test would assert nothing. That is the result of trying, not an assertion that it is hard.",
    id: "unit8:measured-exemption",
    options: [
      "A measurement showing why a fixture cannot work — the zone tooling normalises the fault away",
      "A promise to add the fixture in a later phase",
      "A link to the RFC section it comes from",
      "The name of the engineer who signed it off",
    ],
    prompt:
      "The one entry in `NOT_LOCALLY_REPRODUCIBLE` contains something unusual. What?",
    source: "packages/dns/src/diagnosis/codes.ts",
  },
  {
    correct: 2,
    explanation:
      "Most of an RFC instructs senders and receiving mail servers, so a percentage over its whole text is a number with no measurement behind it. Worse, a coverage metric over a denominator you choose can be improved by cataloguing more of what somebody else's software does.",
    id: "unit8:no-percentage",
    options: [
      "Because the RFCs are updated too often",
      "Because counting requirements is subjective",
      "Because most of an RFC instructs senders and receivers, so the denominator would be meaningless — and one you choose can be gamed",
      "Because the ledger is hand-curated",
    ],
    prompt:
      "Why does the conformance ledger refuse to publish a percentage of an RFC?",
    source: "packages/dns/src/conformance/summary.ts",
  },
  {
    correct: 1,
    explanation:
      "Every entry marked implemented names a test by the exact text of its it(...), and a spec fails the build otherwise. So an entry cannot be marked covered by writing the word — and renaming the test fails the ledger until somebody updates it.",
    id: "unit8:ledger-claim",
    options: [
      "That the implementation is complete",
      "That every requirement marked implemented names a test that exists and asserts it",
      "That every RFC section has been read",
      "That the gaps will be closed in a later phase",
    ],
    prompt: "What narrow claim does the conformance ledger actually support?",
    source: "packages/dns/src/conformance/requirements.ts",
  },
  {
    correct: 3,
    explanation:
      "Matching Svix on the wire means every existing verification library and published example already works, and swapping in a hosted sender later changes nothing for anyone already integrated. The five-minute tolerance is their default for the same reason: a different number would make stock libraries disagree with the documentation.",
    id: "unit8:svix",
    options: [
      "Because Svix's format is cryptographically stronger",
      "Because it was the only format with a Node implementation",
      "Because Svix requires it for compatibility certification",
      "Because customers' existing verification libraries already work, and a later swap changes nothing for them",
    ],
    prompt: "Why is the webhook signature format Svix-compatible?",
    source: "packages/webhooks/src/sign.ts",
  },
  {
    correct: 0,
    explanation:
      "A refactor that silently changes the signing input breaks every customer at once and does so invisibly, because the sending side keeps signing happily. That failure mode is why it has to be independently testable against a fixed vector.",
    id: "unit8:sign-package",
    options: [
      "Because a silent change to the signing input breaks every customer at once, invisibly",
      "Because node:crypto cannot be imported from an app",
      "Because the signature has to be generated in a separate process",
      "Because it will be replaced by Svix later",
    ],
    prompt: "Why is the signing code its own dependency-free package?",
    source: "packages/webhooks/src/sign.ts",
  },
  {
    correct: 2,
    explanation:
      "A customer who cannot do from the SDK what they can do with curl writes their own client — and then there are two clients, and the one you did not write is the one they report bugs against.",
    id: "unit8:sdk-coverage",
    options: [
      "The SDK's types drifting from the API's responses",
      "A route being removed without a deprecation notice",
      "A route the SDK cannot reach, which pushes a customer into writing their own client",
      "An SDK method calling a route that does not exist",
    ],
    prompt: "What failure does the SDK coverage spec exist to catch?",
    source: "apps/api/src/sdk-coverage.spec.ts",
  },
  {
    correct: 1,
    explanation:
      "Constructing the app without a mailer unmounts the signup routes, so the exclusion becomes invisible. Mounting them and excluding them by name is the difference between 'the SDK deliberately omits signup' and 'nobody noticed signup exists'.",
    id: "unit8:mailer-detail",
    options: [
      "To test that signup emails are sent",
      "So the signup routes are mounted and have to be excluded by name rather than invisibly",
      "Because the router cannot be built without one",
      "To keep the spec's setup identical to production",
    ],
    prompt: "Why does the SDK coverage spec construct the app *with* a mailer?",
    source: "apps/api/src/sdk-coverage.spec.ts",
  },
  {
    correct: 3,
    explanation:
      "Skipping multi-region HA is acceptable only because the product is read-only: if it goes down, the customer falls back to their own polling and nothing of theirs breaks. That is a conditional which has to be re-examined the day the product stops being read-only.",
    id: "unit8:ha-conditional",
    options: [
      "Because the infrastructure budget is fixed",
      "Because the sweeper is a single process",
      "Because Postgres cannot replicate across regions",
      "Because the product is read-only, so an outage costs the customer nothing of their own",
    ],
    prompt:
      "Multi-region high availability is deliberately skipped. On what condition does that reasoning depend?",
    source: "docs/DESIGN.md",
  },
  {
    correct: 0,
    explanation:
      "It requires enormous trust — the platform's nameservers going down breaks its customers' customers' mail — and that trust has to be earned by shipping something lower-risk first. Read-only verification earns it.",
    id: "unit8:delegation-deferred",
    options: [
      "It needs trust that read-only verification has to earn first",
      "The RFCs do not permit delegating underscore labels",
      "Hosted authoritative DNS is priced per query",
      "It would require abandoning the copy-paste path",
    ],
    prompt:
      "Delegation is described as the long-term differentiator and is deliberately not built. Why?",
    source: "docs/DESIGN.md",
  },
];

export const QUESTIONS: readonly Question[] = [
  ...AUTHORED,
  unreproducibleCodeQuestion("RRSET_TTL_MISMATCH"),
];
