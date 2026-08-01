---
"@propgate/dns": minor
---

`RRSET_TTL_MISMATCH`: records that belong together carrying different lifetimes,
so part of the set expires before the rest and the answer changes shape with
nothing having been edited (RFC 2181 §5.2).

Three requirements catalogued that were implemented and untested: SPF's
evaluation time limit, EDNS(0) buffer advertisement, and truncation above the
advertised size.
