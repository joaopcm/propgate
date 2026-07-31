---
"@propgate/dns": minor
---

`runChecks` composes the six evaluators into one result, against a
`DomainProfile` that states what the domain is for.

Checks run concurrently with their own contexts, so the wall clock is the
slowest check rather than the sum. A check the profile does not ask for
produces no outcome at all rather than a passing one — six ticks for a domain
that was asked about two is a lie a dashboard should not be able to tell.
