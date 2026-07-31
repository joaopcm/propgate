---
"@propgate/dns": minor
---

First release with any behaviour in it. The published 0.0.0 was the empty
skeleton from Phase 0 — everything below has landed since and none of it had a
changeset, so none of it shipped.

- **DNS wire codec and transports.** Hand-rolled over `node:dgram` and
  `node:net` under a zero-runtime-dependency promise. Fifteen record types, EDNS0,
  the TC bit with TCP fallback, and DNSSEC records. Everything is port-aware;
  53 is never assumed.
- **Public Suffix List**, vendored as generated TypeScript.
- **Evaluators** for SPF, DKIM, DMARC, CAA, MX, and delegation health, sharing a
  lookup budget, a deadline, and a derivation log.
- **A diagnosis taxonomy** of 72 codes, each backed by a fixture or a written
  reason it cannot be reproduced locally.

Results carry the lookups that produced them and a four-valued verdict where
`indeterminate` is distinct from `fail`: a resolver that could not answer is not
a domain that is broken.
