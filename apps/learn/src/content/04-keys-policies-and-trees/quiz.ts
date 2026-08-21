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
      "RFC 6376 §3.6.1 defines an empty p= as revocation. The record is complete and deliberate, so reporting it as malformed tells somebody to go and fix a record they broke on purpose.",
    id: "unit4:revoked",
    options: [
      "The record was truncated in transit",
      "The provider stripped the value because it was too long",
      "The key has been revoked, deliberately",
      "The record is malformed and should be reported as such",
    ],
    prompt: "A DKIM record reads `v=DKIM1; k=rsa; p=`. What does that mean?",
    source: "packages/dns-fixtures/zones/unsigned/dkim.test.zone",
  },
  {
    correct: 1,
    explanation:
      "t=y puts the key in testing mode: receivers must ignore signature failures. The key is published and protecting nothing yet, which is a warning rather than a pass — a domain in this state believes it has DKIM and does not.",
    id: "unit4:testing-mode",
    options: [
      "The key is valid for testing domains only",
      "Receivers must ignore signature failures, so the key protects nothing yet",
      "The key expires after a test period",
      "The record is a draft and receivers ignore it entirely",
    ],
    prompt: "What does `t=y` on a DKIM record mean for the verdict?",
    source: "packages/dns-fixtures/zones/unsigned/dkim.test.zone",
  },
  {
    correct: 3,
    explanation:
      "DNS names fold case, so a lowercase query must find a record published with capitals in the owner name. Base64 does not fold case, so two payloads differing only in case are different keys. A comparison that lowercases everything to be safe about the name makes two different keys look identical.",
    id: "unit4:case",
    options: [
      "Both fold case, so a case-insensitive comparison is always correct",
      "Neither folds case, so an exact comparison is always correct",
      "Base64 folds case but DNS names do not",
      "DNS names fold case and base64 does not, so one comparison needs both behaviours",
    ],
    prompt:
      "How do case rules differ between a DKIM record's owner name and its base64 payload?",
    source: "packages/dns-fixtures/zones/unsigned/txt-split.test.zone",
  },
  {
    correct: 0,
    explanation:
      "RFC 7489 §6.6.3 has receivers query the exact name first and fall back to the organizational domain only when that returns nothing. So sp= governs a subdomain only when the subdomain publishes no policy of its own.",
    id: "unit4:sp-inherit",
    options: [
      "Only when the subdomain publishes no DMARC record of its own",
      "Always, because sp= overrides a subdomain's own policy",
      "Never, because sp= applies only to the organizational domain itself",
      "Only when the subdomain's policy is p=none",
    ],
    prompt: "When does the organizational domain's `sp=` govern a subdomain?",
    source: "packages/dns-fixtures/zones/unsigned/dmarc.test.zone",
  },
  {
    correct: 2,
    explanation:
      "RFC 7489 §7.1 requires the destination to opt in by publishing <source>._report._dmarc.<destination> containing a DMARC record. Without it, receivers that check will drop the reports and the domain owner gets fewer than they think, silently.",
    id: "unit4:external-reports",
    options: [
      "Nothing; any address may be nominated",
      "The destination must appear in the source domain's SPF record",
      "The destination must publish `<source>._report._dmarc.<destination>` with a DMARC record",
      "The source must publish an MX record for the destination",
    ],
    prompt:
      "What has to be true for `rua=mailto:reports@other-domain.com` to actually receive reports?",
    source: "packages/dns-fixtures/zones/unsigned/reports.test.zone",
  },
  {
    correct: 1,
    explanation:
      "A null MX is an MX with preference 0 whose exchange is the root. On a send-only domain it is exactly right. On a domain that receives mail, every message bounces — and nothing in DNS distinguishes the two cases.",
    id: "unit4:null-mx",
    options: [
      "It is always a misconfiguration",
      "It is correct on a send-only domain and catastrophic on one that receives mail",
      "It means mail is delivered to the address record instead",
      "It means the domain has not finished configuring MX yet",
    ],
    prompt: "What does `0 .` as a domain's only MX record mean?",
    source: "packages/dns-fixtures/zones/unsigned/mx.test.zone",
  },
  {
    correct: 3,
    explanation:
      "RFC 2181 §10.3 forbids it. Most senders follow the alias anyway, which is why the ones that refuse produce 'some of our mail gets through' rather than an outright failure — the worst shape of bug to diagnose.",
    id: "unit4:mx-cname",
    options: [
      "It is allowed and works everywhere",
      "It is allowed but slower, because of the extra lookup",
      "It is forbidden and no sender will deliver",
      "It is forbidden, but most senders tolerate it, so failures look intermittent",
    ],
    prompt: "What is wrong with an MX record pointing at a CNAME?",
    source: "packages/dns-fixtures/zones/unsigned/mx.test.zone",
  },
  {
    correct: 0,
    explanation:
      "RFC 8659 makes the nearest ancestor with a CAA record set the answer outright. Policies are never merged up the tree, so a subdomain's own record completely replaces the apex policy rather than adding to it.",
    id: "unit4:caa-climb",
    options: [
      "The nearest ancestor with a CAA record set wins outright; nothing is merged",
      "Policies from every level are combined, and the union of issuers applies",
      "The apex policy always wins",
      "The climb stops at the organizational domain, per the Public Suffix List",
    ],
    prompt:
      "A subdomain has its own CAA record and its apex has a different one. Which applies?",
    source: "packages/dns-fixtures/zones/unsigned/caa.test.zone",
  },
  {
    correct: 2,
    explanation:
      "RFC 8659 §4.1 requires an authority that does not understand a critical property to refuse issuance. So a critical unknown property blocks everything, even when a perfectly good issue property sits next to it in the same record set.",
    id: "unit4:caa-critical",
    options: [
      "The unknown property is ignored and issuance proceeds",
      "Only wildcard issuance is blocked",
      "All issuance is blocked, even though a valid issue property is present",
      "The record set is treated as malformed and CAA is skipped",
    ],
    prompt:
      'A CAA record set contains an unrecognised property with flag 128, alongside `issue "letsencrypt.org"`. What is the effect?',
    source: "packages/dns-fixtures/zones/unsigned/caa.test.zone",
  },
  {
    correct: 1,
    explanation:
      "The organizational domain is one label below the public suffix, and determining it needs the Public Suffix List — co.uk is a suffix while .uk alone is not. CAA's climb is a plain walk up the name and uses no list at all.",
    id: "unit4:psl",
    options: [
      "Both use it, to find the organizational domain",
      "DMARC needs it to find the organizational domain; CAA's climb does not use it",
      "CAA needs it to know where to stop climbing; DMARC does not",
      "Neither uses it",
    ],
    prompt: "Which of DMARC and CAA needs the Public Suffix List, and why?",
    source: "packages/dns/src/psl/index.ts",
  },
];

export const QUESTIONS: readonly Question[] = [
  ...AUTHORED,
  fixtureCodeQuestion("dkim.test", "DKIM_KEY_REVOKED"),
  fixtureCodeQuestion("mx.test", "MX_TARGET_IS_CNAME"),
  fixtureCodeQuestion("caa.test", "CAA_POLICY_FROM_ANCESTOR"),
  fixtureCodeQuestion(
    "unauth-reports.test",
    "DMARC_EXTERNAL_REPORT_UNAUTHORIZED"
  ),
  severityQuestion("DKIM_TESTING_MODE"),
  severityQuestion("DMARC_POLICY_NONE"),
  requirementGapQuestion(8659),
];
