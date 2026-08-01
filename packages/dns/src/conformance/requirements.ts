/**
 * What the RFCs require of a verifier, and whether we do it.
 *
 * **This is a hand-curated ledger, not a measurement of an RFC.** "100% of RFC
 * 7208" is not a number anyone can compute: most of that document instructs
 * senders and receiving MTAs, and a percentage over its whole text would be a
 * number with no receipt. The denominator here is *our* reading of which
 * normative statements apply to something that inspects a domain's records and
 * reports on them. A reader is meant to disagree with that reading — which is
 * why every entry cites a section, and why the gaps are listed rather than
 * quietly excluded.
 *
 * The claim the ledger actually supports is narrow and checkable: **every
 * requirement marked `implemented` names a test that exists and asserts it.**
 * `conformance.spec.ts` fails the build otherwise, so an entry cannot be marked
 * covered by writing the word. That is the same shape as the diagnosis coverage
 * guard: a table joined to the test suite, enforced by the test suite.
 *
 * Adding a requirement is cheap and worth doing even when the answer is "we do
 * not do this". The gap list is the part a consumer cannot get anywhere else.
 */

export type RequirementStatus =
  | "implemented"
  | "not-applicable"
  | "not-implemented";

export interface Proof {
  /** Path relative to `packages/dns`. */
  readonly spec: string;
  /** Text of the `it(...)` that asserts this. Matched exactly. */
  readonly test: string;
}

export interface Requirement {
  /**
   * Why, in one sentence.
   *
   * Required for everything except `implemented`, where the proof speaks. A
   * gap without a reason is indistinguishable from an oversight.
   */
  readonly note?: string;
  readonly proof?: readonly Proof[];
  /** What the RFC asks of a verifier, in plain terms. */
  readonly requirement: string;
  readonly rfc: number;
  /** Section number as written in the RFC, e.g. "4.6.4". */
  readonly section: string;
  readonly status: RequirementStatus;
}

const SPF_RECORD = "src/evaluate/spf-record.spec.ts";
const SPF = "src/evaluate/spf.fixture.spec.ts";
const SPF_MATCH = "src/evaluate/spf-match.fixture.spec.ts";
const SPF_MACRO = "src/evaluate/spf-macro.spec.ts";
const DKIM_RECORD = "src/evaluate/dkim-record.spec.ts";
const DKIM = "src/evaluate/dkim.fixture.spec.ts";
const DMARC_RECORD = "src/evaluate/dmarc-record.spec.ts";
const DMARC = "src/evaluate/dmarc.fixture.spec.ts";
const CAA_RECORD = "src/evaluate/caa-record.spec.ts";
const CAA = "src/evaluate/caa.fixture.spec.ts";
const MX = "src/evaluate/mx.fixture.spec.ts";
const DELEGATION = "src/evaluate/delegation.fixture.spec.ts";
const WIRE_MESSAGE = "src/wire/message.spec.ts";
const WIRE_READER = "src/wire/reader.spec.ts";
const ANSWER = "src/evaluate/answer.fixture.spec.ts";
const ANSWER_UNIT = "src/evaluate/answer.spec.ts";
const BUDGET = "src/evaluate/budget.fixture.spec.ts";
const QUERY = "src/transport/query.fixture.spec.ts";

const SPF_REQUIREMENTS: readonly Requirement[] = [
  {
    proof: [
      {
        spec: SPF_RECORD,
        test: "accepts the version token in any case, with or without terms",
      },
      {
        spec: SPF,
        test: "does not count an unrelated TXT record as a second SPF record",
      },
    ],
    requirement:
      "Records not beginning with v=spf1 are discarded before any are counted",
    rfc: 7208,
    section: "4.5",
    status: "implemented",
  },
  {
    proof: [
      { spec: SPF, test: "treats two SPF records as authorising nothing" },
    ],
    requirement: "More than one SPF record is a permanent error",
    rfc: 7208,
    section: "4.5",
    status: "implemented",
  },
  {
    proof: [{ spec: SPF_RECORD, test: "defaults to + when none is written" }],
    requirement: "A mechanism with no qualifier is treated as +",
    rfc: 7208,
    section: "4.6.2",
    status: "implemented",
  },
  {
    proof: [
      { spec: SPF, test: "fails on the eleventh, not the tenth" },
      {
        spec: SPF,
        test: "never performs the lookup that would exceed the limit",
      },
    ],
    requirement:
      "At most ten terms causing DNS queries, across the whole include tree",
    rfc: 7208,
    section: "4.6.4",
    status: "implemented",
  },
  {
    proof: [{ spec: SPF, test: "fails on the third" }],
    requirement: "At most two void lookups",
    rfc: 7208,
    section: "4.6.4",
    status: "implemented",
  },
  {
    proof: [
      { spec: SPF, test: "rejects an mx expanding to more than ten names" },
    ],
    requirement: "An mx mechanism must not expand to more than ten names",
    rfc: 7208,
    section: "4.6.4",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: SPF_MATCH,
        test: "spends only one of the ten on the whole mechanism",
      },
    ],
    requirement:
      "Address lookups behind an mx mechanism are outside the ten-term limit",
    rfc: 7208,
    section: "4.6.4",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: SPF_MACRO,
        test: "substitutes postmaster@<helo> when there is no envelope sender",
      },
    ],
    requirement:
      "An empty MAIL FROM is treated as postmaster at the HELO domain",
    rfc: 7208,
    section: "4.3",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: SPF,
        test: "treats an include of a domain with no SPF record as permerror",
      },
    ],
    requirement: "An include: target with no SPF record is a permanent error",
    rfc: 7208,
    section: "5.2",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: SPF_MATCH,
        test: "does not let a nested -all reject the message",
      },
      { spec: SPF_MATCH, test: "authorises a host the included record lists" },
    ],
    requirement:
      "An include: matches only when the recursive evaluation returns pass",
    rfc: 7208,
    section: "5.2",
    status: "implemented",
  },
  {
    proof: [{ spec: SPF, test: "warns about ptr rather than rejecting it" }],
    requirement: "ptr is valid syntax and SHOULD NOT be published",
    rfc: 7208,
    section: "5.5",
    status: "implemented",
  },
  {
    note: "Deciding one needs a reverse lookup of the connecting address and a forward confirmation of every name it returns. We report the term as undetermined for a specific sender rather than guessing, which is visible as SPF_IP_UNDETERMINED.",
    proof: [{ spec: SPF_MATCH, test: "does not guess at a ptr mechanism" }],
    requirement: "Evaluating whether a ptr mechanism matches a given client",
    rfc: 7208,
    section: "5.5",
    status: "not-implemented",
  },
  {
    proof: [
      { spec: SPF_MATCH, test: "never matches across families" },
      { spec: SPF_MATCH, test: "treats an IPv4-mapped address as IPv4" },
    ],
    requirement: "ip4 matches only IPv4 clients and ip6 only IPv6 clients",
    rfc: 7208,
    section: "5.6",
    status: "implemented",
  },
  {
    proof: [
      { spec: SPF_MATCH, test: "stops at the first match, not the best one" },
    ],
    requirement: "The result is the qualifier of the first matching mechanism",
    rfc: 7208,
    section: "4.6.2",
    status: "implemented",
  },
  {
    proof: [{ spec: SPF_RECORD, test: "rejects a second redirect or exp" }],
    requirement: "redirect= and exp= must not appear more than once",
    rfc: 7208,
    section: "6",
    status: "implemented",
  },
  {
    proof: [
      { spec: SPF, test: "reports a redirect that all makes unreachable" },
    ],
    requirement:
      "redirect= is ignored when the record contains an all mechanism",
    rfc: 7208,
    section: "6.1",
    status: "implemented",
  },
  {
    proof: [
      { spec: SPF_MATCH, test: "takes the target's result, qualifier and all" },
    ],
    requirement:
      "A redirect's result is the record's result, unlike an include",
    rfc: 7208,
    section: "6.1",
    status: "implemented",
  },
  {
    note: "exp= text is fetched only to build a rejection message after the outcome is already decided, so it changes no verdict. Parsing the modifier is implemented; retrieving and expanding the explanation string is not.",
    requirement: "Fetching and macro-expanding exp= text on a fail",
    rfc: 7208,
    section: "6.2",
    status: "not-implemented",
  },
  {
    proof: [
      { spec: SPF_MACRO, test: "builds the section's full example names" },
      { spec: SPF_MACRO, test: "calls a malformed macro a syntax error" },
      { spec: SPF_MACRO, test: "passes every letter a domain-spec may use" },
    ],
    requirement:
      "Macro grammar: letters, transformers, delimiters, and the %% %_ %- escapes",
    rfc: 7208,
    section: "7.1",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: SPF_MACRO,
        test: "rejects an exp-only macro letter in a domain-spec",
      },
    ],
    requirement: "The c, r and t macros are valid only inside exp= text",
    rfc: 7208,
    section: "7.2",
    status: "implemented",
  },
  {
    note: "It is the validated domain name of the connecting address, which needs the same reverse lookup and forward confirmation as the ptr mechanism. §7.3 advises against publishing it. Reported as unevaluable rather than guessed.",
    proof: [{ spec: SPF_MACRO, test: "does not attempt %{p}" }],
    requirement: "Expanding the %{p} macro",
    rfc: 7208,
    section: "7.3",
    status: "not-implemented",
  },
  {
    proof: [
      { spec: SPF_MACRO, test: "reverses before taking the rightmost parts" },
      {
        spec: SPF_MACRO,
        test: "splits on every delimiter in the set, and on nothing else",
      },
    ],
    requirement:
      "Transformers apply in order: split, reverse, then keep the rightmost N",
    rfc: 7208,
    section: "7.3",
    status: "implemented",
  },
  {
    proof: [{ spec: SPF_MACRO, test: "URL-escapes an uppercase macro" }],
    requirement: "An uppercase macro letter URL-escapes its expansion",
    rfc: 7208,
    section: "7.3",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: SPF_MACRO,
        test: "drops whole labels from the left when over 253 characters",
      },
    ],
    requirement:
      "An expansion longer than 253 characters loses leading labels rather than being rejected",
    rfc: 7208,
    section: "7.3",
    status: "implemented",
  },
  {
    proof: [
      { spec: SPF_MACRO, test: "expands %{ir} to reversed nibbles" },
      { spec: SPF_MACRO, test: "uses ip6 rather than in-addr for %{v}" },
    ],
    requirement:
      "%{i} is dot-separated nibbles for IPv6, and %{v} is ip6 rather than in-addr",
    rfc: 7208,
    section: "7.3",
    status: "implemented",
  },
  {
    proof: [
      { spec: SPF, test: "returns indeterminate when an include SERVFAILs" },
      { spec: SPF, test: "resolves fine through the non-validating tier" },
    ],
    requirement:
      "A DNS failure during evaluation is temperror, distinct from permerror",
    rfc: 7208,
    section: "4.4",
    status: "implemented",
  },
  {
    proof: [
      { spec: BUDGET, test: "stops spending lookups once the budget is gone" },
      {
        spec: BUDGET,
        test: "is indeterminate, never a verdict about the domain",
      },
    ],
    requirement:
      "The total time spent evaluating a record is bounded, not only the number of lookups",
    rfc: 7208,
    section: "4.6.4",
    status: "implemented",
  },
  {
    proof: [
      { spec: SPF_MATCH, test: "is neutral by default when there is no all" },
    ],
    requirement:
      "A record that matches nothing and has no all evaluates to neutral",
    rfc: 7208,
    section: "4.7",
    status: "implemented",
  },
  {
    note: "We audit the record rather than serving a message, so there is no reply to insert a header into.",
    requirement: "Receivers prepend a Received-SPF header",
    rfc: 7208,
    section: "9.1",
    status: "not-applicable",
  },
  {
    note: "A property of the sending MTA's configuration, not of the domain's records.",
    requirement: "Checking HELO identity in addition to MAIL FROM",
    rfc: 7208,
    section: "2.3",
    status: "not-applicable",
  },
];

const DKIM_REQUIREMENTS: readonly Requirement[] = [
  {
    proof: [
      { spec: DKIM_RECORD, test: "rejects v= that is not the first tag" },
    ],
    requirement: "v= must be the first tag when present",
    rfc: 6376,
    section: "3.6.1",
    status: "implemented",
  },
  {
    proof: [{ spec: DKIM_RECORD, test: "rejects a version that is not DKIM1" }],
    requirement: "A version other than DKIM1 makes the record unusable",
    rfc: 6376,
    section: "3.6.1",
    status: "implemented",
  },
  {
    proof: [{ spec: DKIM_RECORD, test: "defaults k= to rsa, per the RFC" }],
    requirement: "k= defaults to rsa when absent",
    rfc: 6376,
    section: "3.6.1",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: DKIM_RECORD,
        test: "treats an empty p= as revocation, not corruption",
      },
      {
        spec: DKIM,
        test: "reports an empty p= as revoked rather than malformed",
      },
    ],
    requirement: "An empty p= means the key has been revoked",
    rfc: 6376,
    section: "3.6.1",
    status: "implemented",
  },
  {
    proof: [{ spec: DKIM_RECORD, test: "rejects a record with no p= tag" }],
    requirement: "A record with no p= tag is malformed",
    rfc: 6376,
    section: "3.6.1",
    status: "implemented",
  },
  {
    proof: [
      { spec: DKIM_RECORD, test: "is true only when t= contains y" },
      {
        spec: DKIM,
        test: "warns about testing mode, which protects nothing yet",
      },
    ],
    requirement:
      "t=y marks the domain as testing, so receivers must not act on failures",
    rfc: 6376,
    section: "3.6.1",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: DKIM_RECORD,
        test: "rejects a duplicated tag rather than picking one",
      },
    ],
    requirement: "A duplicated tag makes the record unusable",
    rfc: 6376,
    section: "3.2",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: DKIM_RECORD,
        test: "reports the real modulus length of an RSA key",
      },
    ],
    requirement: "p= is a DER SubjectPublicKeyInfo, base64 encoded",
    rfc: 6376,
    section: "3.6.1",
    status: "implemented",
  },
  {
    proof: [
      { spec: DKIM_RECORD, test: "accepts a raw 32-byte ed25519 key" },
      { spec: DKIM, test: "accepts a raw ed25519 key" },
    ],
    requirement: "k=ed25519 keys are a raw 32-byte public key, base64 encoded",
    rfc: 8463,
    section: "3",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: DKIM_RECORD,
        test: "accepts folding whitespace inside the base64, which §2.10 permits",
      },
      {
        spec: DKIM,
        test: "accepts a key split with whitespace at the chunk boundary",
      },
    ],
    requirement:
      "Folding whitespace is permitted at arbitrary places inside a base64 value",
    rfc: 6376,
    section: "2.10",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: DKIM,
        test: "does not treat a key differing only in case as the same key",
      },
    ],
    requirement:
      "Tag values are case-sensitive unless a tag says otherwise, so base64 key material is compared exactly",
    rfc: 6376,
    section: "3.2",
    status: "implemented",
  },
  {
    note: "Verifying a signature needs the message, which a records check does not have. We check that the published key is present, parseable, of a usable algorithm and length, and is the key that was issued.",
    requirement: "Verifying a DKIM-Signature header against a message body",
    rfc: 6376,
    section: "6.1",
    status: "not-applicable",
  },
  {
    note: "Canonicalisation applies to a message being signed or verified, not to a key record.",
    requirement: "Header and body canonicalisation",
    rfc: 6376,
    section: "3.4",
    status: "not-applicable",
  },
];

const DMARC_REQUIREMENTS: readonly Requirement[] = [
  {
    proof: [
      {
        spec: DMARC,
        test: "uses a subdomain's own policy, not the organizational one",
      },
      {
        spec: DMARC,
        test: "falls back to the organizational domain and applies sp=",
      },
      { spec: DMARC, test: "never falls back past the organizational domain" },
    ],
    requirement:
      "Query the exact name first, then the organizational domain, and no further",
    rfc: 7489,
    section: "6.6.3",
    status: "implemented",
  },
  {
    proof: [{ spec: DMARC, test: "ignores an unrelated TXT sharing the name" }],
    requirement:
      "Records not beginning with v=DMARC1 are discarded before counting",
    rfc: 7489,
    section: "6.6.3",
    status: "implemented",
  },
  {
    proof: [{ spec: DMARC, test: "treats two records as no policy at all" }],
    requirement: "More than one DMARC record means no policy is applied",
    rfc: 7489,
    section: "6.6.3",
    status: "implemented",
  },
  {
    proof: [
      { spec: DMARC_RECORD, test: "rejects v= that is not the first tag" },
    ],
    requirement: "v= must be the first tag",
    rfc: 7489,
    section: "6.3",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: DMARC_RECORD,
        test: "defaults alignment to relaxed and pct to 100",
      },
      { spec: DMARC_RECORD, test: "rejects pct above 100" },
    ],
    requirement:
      "adkim and aspf default to relaxed; pct defaults to 100 and is 0–100",
    rfc: 7489,
    section: "6.3",
    status: "implemented",
  },
  {
    proof: [{ spec: DMARC_RECORD, test: "rejects an unknown policy value" }],
    requirement: "p= is none, quarantine or reject",
    rfc: 7489,
    section: "6.3",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: DMARC_RECORD,
        test: "uses sp= when the policy was inherited from the org domain",
      },
      {
        spec: DMARC_RECORD,
        test: "falls back to p= when inherited and no sp= is set",
      },
    ],
    requirement:
      "sp= governs subdomains only when the policy came from the organizational domain",
    rfc: 7489,
    section: "6.3",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: DMARC,
        test: "passes when the destination has authorised the source",
      },
      {
        spec: DMARC,
        test: "fails when the destination has not, since reports vanish silently",
      },
      {
        spec: DMARC,
        test: "does not check authorization for a same-domain address",
      },
    ],
    requirement:
      "An external report destination must publish <source>._report._dmarc.<destination>",
    rfc: 7489,
    section: "7.1",
    status: "implemented",
  },
  {
    note: "Applying a policy needs a message that failed authentication. We report what the policy would do, which is what a domain owner can act on before any mail is sent.",
    requirement:
      "Applying the policy to a failing message, including pct sampling",
    rfc: 7489,
    section: "6.6.4",
    status: "not-applicable",
  },
  {
    note: "Generating aggregate reports is a receiver's job. We check that the addresses they would be sent to are authorised to receive them, which is the part domain owners get wrong.",
    requirement: "Producing aggregate and failure reports",
    rfc: 7489,
    section: "7.2",
    status: "not-applicable",
  },
];

const CAA_REQUIREMENTS: readonly Requirement[] = [
  {
    proof: [
      { spec: CAA, test: "stops before the root, per RFC 8659 §3" },
      { spec: CAA, test: "climbs more than one label to find a policy" },
    ],
    requirement:
      "The search climbs from the name up to, but not including, the root",
    rfc: 8659,
    section: "3",
    status: "implemented",
  },
  {
    proof: [
      { spec: CAA, test: "does not merge a nearer policy with the apex's" },
    ],
    requirement:
      "The nearest ancestor with a CAA RRset governs; policies are not merged",
    rfc: 8659,
    section: "3",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: CAA,
        test: "crosses a zone cut rather than stopping at the delegation",
      },
    ],
    requirement: "The climb crosses zone cuts",
    rfc: 8659,
    section: "3",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: CAA_RECORD,
        test: "blocks issuance on an unknown critical property, whatever else is allowed",
      },
      {
        spec: CAA,
        test: "blocks issuance despite the policy also naming our CA",
      },
    ],
    requirement:
      "An unrecognised property with the critical bit forbids issuance entirely",
    rfc: 8659,
    section: "4.1",
    status: "implemented",
  },
  {
    proof: [
      { spec: CAA_RECORD, test: "separates parameters from the CA name" },
      {
        spec: CAA_RECORD,
        test: "treats an empty issuer-domain-name as deny-all",
      },
    ],
    requirement:
      "issue/issuewild values are a CA domain with optional ;key=value parameters; empty means deny all",
    rfc: 8659,
    section: "4.2",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: CAA_RECORD,
        test: "uses issuewild for a wildcard, ignoring issue",
      },
      {
        spec: CAA_RECORD,
        test: "falls back to issue for wildcards when no issuewild exists",
      },
    ],
    requirement: "issuewild governs wildcard issuance exclusively when present",
    rfc: 8659,
    section: "4.3",
    status: "implemented",
  },
  {
    note: "iodef addresses are parsed and reported. Sending a report is an authority's job at issuance time, not a checker's.",
    requirement: "Reporting a rejected issuance to the iodef address",
    rfc: 8659,
    section: "4.4",
    status: "not-applicable",
  },
  {
    note: "The DNSSEC state of the CAA RRset is what a CA must consider. We rely on the resolver's validation rather than validating ourselves — see the DNSSEC entries.",
    requirement: "A CA must consider the DNSSEC validation state of the RRset",
    rfc: 8659,
    section: "5",
    status: "not-implemented",
  },
];

const MAIL_ROUTING_REQUIREMENTS: readonly Requirement[] = [
  {
    proof: [
      { spec: MX, test: "is correct for a domain that only sends" },
      { spec: MX, test: "is a failure for a domain that expects mail" },
    ],
    requirement:
      "A null MX (preference 0, exchange root) means the domain accepts no mail",
    rfc: 7505,
    section: "3",
    status: "implemented",
  },
  {
    proof: [
      { spec: MX, test: "rejects a null MX published alongside a real one" },
    ],
    requirement: "A null MX must be the only MX record",
    rfc: 7505,
    section: "3",
    status: "implemented",
  },
  {
    proof: [
      { spec: MX, test: "reports delivery falling back to the address record" },
    ],
    requirement:
      "With no MX, the domain's address record is the implicit mail exchange",
    rfc: 5321,
    section: "5.1",
    status: "implemented",
  },
  {
    proof: [{ spec: MX, test: "is a warning, not a failure" }],
    requirement: "An MX exchange must not point at an alias",
    rfc: 2181,
    section: "10.3",
    status: "implemented",
  },
];

const DELEGATION_REQUIREMENTS: readonly Requirement[] = [
  {
    proof: [
      { spec: DELEGATION, test: "is a warning even when everything works" },
    ],
    requirement: "A zone should be served by at least two nameservers",
    rfc: 1034,
    section: "4.1",
    status: "implemented",
  },
  {
    proof: [
      { spec: DELEGATION, test: "names the server that is not authoritative" },
    ],
    requirement:
      "Every nameserver a zone is delegated to must be authoritative for it",
    rfc: 1034,
    section: "4.2.2",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: DELEGATION,
        test: "reports a nameserver the zone claims and the parent does not",
      },
    ],
    requirement:
      "The parent's delegation and the zone's own NS RRset should agree",
    rfc: 1034,
    section: "4.2.2",
    status: "implemented",
  },
  {
    proof: [{ spec: DELEGATION, test: "says which server holds which serial" }],
    requirement:
      "Authoritative servers for a zone serve the same version of it",
    rfc: 1034,
    section: "4.3.5",
    status: "implemented",
  },
];

const TRANSPORT_REQUIREMENTS: readonly Requirement[] = [
  {
    proof: [
      { spec: WIRE_READER, test: "follows a backward compression pointer" },
      {
        spec: WIRE_READER,
        test: "rejects a forward pointer, the classic decompression-loop vector",
      },
    ],
    requirement:
      "Name compression: a pointer refers to a prior occurrence of the name",
    rfc: 1035,
    section: "4.1.4",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: WIRE_MESSAGE,
        test: "keeps TXT chunks separate so split mangling stays visible",
      },
    ],
    requirement:
      "TXT rdata is a sequence of character-strings, each at most 255 octets",
    rfc: 1035,
    section: "3.3.14",
    status: "implemented",
  },
  {
    proof: [
      { spec: WIRE_READER, test: "rejects a label longer than 63 bytes" },
    ],
    requirement: "A label is at most 63 octets and a name at most 255",
    rfc: 1035,
    section: "2.3.4",
    status: "implemented",
  },
  {
    proof: [{ spec: DKIM, test: "finds a selector published in mixed case" }],
    requirement: "Domain name comparison is case-insensitive",
    rfc: 4343,
    section: "3",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: QUERY,
        test: "preserves the provider's split rather than silently joining it",
      },
      {
        spec: DKIM,
        test: "accepts a key split with whitespace at the chunk boundary",
      },
    ],
    requirement:
      "The character-strings of one TXT rdata concatenate with no separator between them",
    rfc: 1035,
    section: "3.3.14",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: QUERY,
        test: "sets TC for a 4096-bit key when no OPT record is sent",
      },
      {
        spec: QUERY,
        test: "does NOT truncate a 2048-bit key, whose response is 483 bytes",
      },
    ],
    requirement:
      "A requestor advertises its receive buffer size in the OPT record, and 512 octets applies when no OPT is sent",
    rfc: 6891,
    section: "6.2.3",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: QUERY,
        test: "still truncates the 4.4 KB TXT even at an advertised 4096",
      },
    ],
    requirement:
      "A response larger than the advertised buffer is truncated with TC set rather than sent whole",
    rfc: 6891,
    section: "6.2.4",
    status: "implemented",
  },
  {
    proof: [{ spec: ANSWER_UNIT, test: "is true when one record differs" }],
    requirement: "Every record in an RRset carries the same TTL",
    rfc: 2181,
    section: "5.2",
    status: "implemented",
  },
  {
    note: "We rely on the resolver we query, and read the AD bit it sets. Validating the chain ourselves would mean shipping a trust anchor and a validator, which is Phase 2 work at the earliest — the fixture tier already carries signed, bogus and insecure-island zones for it.",
    requirement: "Validating the DNSSEC chain of trust for an answer",
    rfc: 4035,
    section: "5",
    status: "not-implemented",
  },
  {
    proof: [
      {
        spec: ANSWER,
        test: "warns when a negative answer is cached for an hour",
      },
      { spec: ANSWER, test: "stays quiet at a minute, which nobody notices" },
    ],
    requirement:
      "A negative answer is remembered for the lesser of the SOA minimum and the SOA TTL",
    rfc: 2308,
    section: "5",
    status: "implemented",
  },
  {
    proof: [
      { spec: ANSWER, test: "says the name exists when it does" },
      {
        spec: ANSWER,
        test: "stays quiet when the name genuinely does not exist",
      },
    ],
    requirement:
      "NODATA and NXDOMAIN are distinct: one says the type is absent, the other that the name is",
    rfc: 2308,
    section: "2",
    status: "implemented",
  },
  {
    proof: [
      {
        spec: ANSWER,
        test: "is reported, because it is a hair away from not arriving",
      },
      {
        spec: QUERY,
        test: "retrieves the whole 4096-bit key by retrying over TCP",
      },
    ],
    requirement:
      "A truncated answer is retried over TCP rather than used as received",
    rfc: 1035,
    section: "4.2.2",
    status: "implemented",
  },
];

export const REQUIREMENTS: readonly Requirement[] = [
  ...SPF_REQUIREMENTS,
  ...DKIM_REQUIREMENTS,
  ...DMARC_REQUIREMENTS,
  ...CAA_REQUIREMENTS,
  ...MAIL_ROUTING_REQUIREMENTS,
  ...DELEGATION_REQUIREMENTS,
  ...TRANSPORT_REQUIREMENTS,
];

/** What each RFC is, for the published table. */
export const RFC_TITLES: Readonly<Record<number, string>> = {
  1034: "Domain names — concepts and facilities",
  1035: "Domain names — implementation and specification",
  2181: "Clarifications to the DNS specification",
  2308: "Negative caching of DNS queries",
  4035: "Protocol modifications for DNSSEC",
  4343: "Domain name system case insensitivity clarification",
  5321: "Simple Mail Transfer Protocol",
  6376: "DomainKeys Identified Mail (DKIM) signatures",
  6891: "Extension mechanisms for DNS (EDNS(0))",
  7208: "Sender Policy Framework (SPF)",
  7489: "Domain-based Message Authentication, Reporting and Conformance (DMARC)",
  7505: "A null MX resource record",
  8463: "Ed25519 signatures for DKIM",
  8659: "DNS Certification Authority Authorization (CAA)",
};
