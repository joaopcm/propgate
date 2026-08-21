/**
 * What the course is, in order.
 *
 * One array, and it is the only place the answer lives. The spine renders it,
 * the routes are generated from it, the exam samples it, and
 * `curriculum.spec.ts` walks it against the filesystem — so a unit listed here
 * without content on disk is a failing test rather than a blank page, and a
 * directory nobody listed is a failing test rather than dead weight.
 *
 * That is the same shape as `apps/docs/src/lib/navigation.ts`, deliberately.
 * It is the pattern this repository already trusts for the problem of a table
 * and a filesystem drifting apart.
 *
 * Order is array order. There is no `order` field to get wrong.
 */

export interface Unit {
  /**
   * What the reader should already have, in one line.
   *
   * Shown on the unit header rather than used to compute anything. Gating is
   * strictly sequential, so this is a promise about the prose rather than a
   * dependency graph — but a reader who skipped ahead deserves to know what
   * the unit assumes they read.
   */
  readonly assumes: string;
  /** One sentence on what the reader leaves with. Shown on the cover. */
  readonly blurb: string;
  /**
   * Whether this unit's exercises need the fixture tier running.
   *
   * Drives the setup note. Units 7 and 8 are false: their exercises are
   * reading guard specs and making one fail on purpose, which needs a
   * checkout and no containers.
   */
  readonly needsFixtures: boolean;
  /**
   * The `##` headings inside `unit.mdx`, in order.
   *
   * Duplicated from the prose, which would normally be a smell. It earns its
   * place because `curriculum.spec.ts` asserts each one appears in the file:
   * the spine can show a unit's shape without parsing MDX at request time, and
   * a heading renamed in the prose without being renamed here fails the suite
   * rather than quietly dropping out of the rail.
   */
  readonly sections: readonly string[];
  readonly slug: string;
  readonly title: string;
}

export const CURRICULUM: readonly Unit[] = [
  {
    assumes: "Nothing. This is the first unit.",
    blurb:
      "Why every SaaS that asks customers to edit DNS rebuilds the same system badly, and why 'record not found' is the bug rather than the answer.",
    needsFixtures: false,
    sections: [
      "The six records nobody wants to own",
      "Eighty percent in two weeks",
      "What a support ticket costs",
      "Seven invariants and what each one bought",
    ],
    slug: "the-last-twenty-percent",
    title: "The last 20%",
  },
  {
    assumes: "Unit 0. No DNS knowledge beyond having edited a zone once.",
    blurb:
      "The failure modes that make naive verification wrong: NODATA against NXDOMAIN, negative caching, wildcard synthesis, flattened aliases, appended zone names, split strings, and truncation.",
    needsFixtures: true,
    sections: [
      "Two ways for a name to have no answer",
      "The answer that is cached before it exists",
      "The record that makes everything pass",
      "The alias that is not an alias",
      "The name with the zone on the end",
      "Two hundred and fifty-five characters",
      "The flag dig will not show you",
      "Signed, unsigned, and lying",
    ],
    slug: "dns-does-not-tell-the-truth",
    title: "DNS does not tell the truth",
  },
  {
    assumes: "Unit 1. Comfort reading hexadecimal helps and is not required.",
    blurb:
      "Building a resolver from Node built-ins: the wire format byte by byte, name compression, EDNS0, following a delegation from the root, and why a nameserver's port is a field.",
    needsFixtures: true,
    sections: [
      "Twelve bytes of header",
      "A question, encoded",
      "The pointer that saves the packet",
      "Reading an answer by hand",
      "EDNS0, and asking for a bigger envelope",
      "Following a delegation from the root",
      "Why port is a field and not the number 53",
      "The query budget",
    ],
    slug: "a-resolver-with-no-dependencies",
    title: "A resolver with no dependencies",
  },
  {
    assumes: "Units 1 and 2. You can query a name and read the answer.",
    blurb:
      "RFC 7208 as a program rather than a pattern: the ten-lookup limit and exactly where it is counted, the two-void limit, macro expansion, and the difference between redirect and all.",
    needsFixtures: true,
    sections: [
      "A sender policy is a program",
      "Qualifiers, and the one nobody writes",
      "Ten lookups, and which terms spend one",
      "Failing on the eleventh, not the tenth",
      "Two void lookups",
      "Macros, and the ones that cannot be expanded here",
      "redirect is not include",
      "Terms after all",
    ],
    slug: "spf-the-way-an-mta-reads-it",
    title: "SPF the way an MTA reads it",
  },
  {
    assumes: "Unit 3. The idea that a record is parsed rather than matched.",
    blurb:
      "The other four evaluators: DKIM key parsing and what an empty p= means, DMARC at the organizational domain, the null MX, and climbing the CAA tree.",
    needsFixtures: true,
    sections: [
      "A DKIM record is a key, not a string",
      "Empty p= means revoked",
      "Base64 is case-sensitive and DNS names are not",
      "DMARC lives at the organizational domain",
      "Authorising someone else to receive your reports",
      "The null MX",
      "An MX may not point at an alias",
      "Climbing the CAA tree",
    ],
    slug: "keys-policies-and-trees",
    title: "Keys, policies, and trees",
  },
  {
    assumes: "Units 3 and 4. What each evaluator can and cannot decide alone.",
    blurb:
      "Why a checker needs to be told what a domain is for: profiles as shape, expectations as values, four verdicts instead of a boolean, and why a skipped check is not a passing one.",
    needsFixtures: true,
    sections: [
      "A null MX is correct and catastrophic",
      "The profile states the shape",
      "The domain supplies the values",
      "One profile version per domain, and why that failed",
      "Checks that repeat, and the discriminator they need",
      "Four verdicts",
      "The worst of the parts",
      "A skipped check is not a passing check",
    ],
    slug: "asking-the-right-question",
    title: "Asking the right question",
  },
  {
    assumes: "Unit 5. Verdicts, and that indeterminate is one of them.",
    blurb:
      "The highest-stakes correctness property in the product: consensus across vantage points, consecutive-failure thresholds, and a schedule that adapts to what state a domain is in.",
    needsFixtures: true,
    sections: [
      "The webhook that pages the wrong person",
      "Asking from more than one place",
      "Disagreement is uncertainty, not failure",
      "What three resolvers on one host cannot see",
      "Counting failures",
      "Why indeterminate neither increments nor resets",
      "degraded needs something to have regressed from",
      "Once per episode",
      "Thirty seconds, then five minutes, then a day",
      "The TTL floor, and where it does not apply",
    ],
    slug: "believing-a-failure",
    title: "Believing a failure",
  },
  {
    assumes: "Unit 6. The sweeper, and what it does on each tick.",
    blurb:
      "Where the architecture and the invoice are the same decision: storing changes instead of observations, adaptive scheduling, and why a polling loop can never be serverless.",
    needsFixtures: false,
    sections: [
      "Three hundred and sixty thousand rows a day",
      "Store changes, never observations",
      "What a timeline is actually comparing",
      "Uniform sweeping costs ten times as much",
      "The SOA serial fast path",
      "The worst possible fit for per-invocation billing",
      "Postgres is truth, Redis is the conveyor",
      "A job payload carries identifiers and nothing else",
      "Quotas, and what a single check costs somebody else",
    ],
    slug: "the-parts-that-cost-money",
    title: "The parts that cost money",
  },
  {
    assumes: "Every previous unit. This one is about the seams between them.",
    blurb:
      "What it takes to publish a diagnosis code as an API: coverage guards, an RFC ledger with no percentage in it, signed webhooks with a delivery ledger, and the parts deliberately left unbuilt.",
    needsFixtures: false,
    sections: [
      "A code consumers switch on",
      "The guard that will not let the taxonomy drift",
      "NOT_LOCALLY_REPRODUCIBLE",
      "Why no percentage of an RFC exists",
      "A ledger where every claim names a test",
      "Signing, and the ledger of what is owed",
      "A route with no way to reach it",
      "What is deliberately not built",
      "Where to go next",
    ],
    slug: "publishing-a-contract",
    title: "Publishing a contract",
  },
];

/** Directory name for a unit's content, zero-padded so `ls` sorts correctly. */
export function contentDirFor(index: number, slug: string): string {
  return `${String(index).padStart(2, "0")}-${slug}`;
}

export function unitBySlug(slug: string): Unit | undefined {
  return CURRICULUM.find((unit) => unit.slug === slug);
}

export function unitIndex(slug: string): number {
  return CURRICULUM.findIndex((unit) => unit.slug === slug);
}
