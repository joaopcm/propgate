---
"@propgate/dns": minor
"@propgate/cli": minor
---

Add the `ownership` and `cname` checks — the two record kinds `docs/DESIGN.md`
names on line 13 and then never picks up.

`ownership` compares a TXT value against a token the platform minted, byte for
byte. The exact comparison is what makes it immune to a wildcard, which is why
there is no synthesis probe: a zone answering every name still has to answer
with your value. What it adds over a presence check is the near-miss analysis —
a token stored with its quotes, split and rejoined with whitespace, truncated by
a length-limited field, or case-folded is reported as a mangled token rather
than a wrong one, because the customer had the right value and something spent
it on the way to DNS.

`cname` resolves the target it was given so a provider that flattens aliases
into address records passes rather than failing. That is also what finally emits
`PROVIDER_FLATTENED_CNAME`, which has been published with nothing behind it —
the fixture standing in for our infrastructure was already there, waiting for an
evaluator that knew which addresses to compare against. `NOT_YET_EMITTED` is now
empty.

The address comparison is a **subset** test rather than an overlap test, which
is the difference between a pass and a false pass: a flattening provider stores
some subset of the target's addresses and nothing else, while a customer who
*added* our record beside their previous vendor's leaves one of ours and one of
theirs. Resolvers hand out the whole set, so requests split between us and a
host we have never heard of — which reads as "it works sometimes" and is
reported as `CNAME_TARGET_PARTIAL`.

New diagnosis codes: `OWNERSHIP_TOKEN_MISSING`, `OWNERSHIP_TOKEN_MISMATCH`,
`CNAME_RECORD_MISSING`, `CNAME_TARGET_MISMATCH`, `CNAME_TARGET_PARTIAL`. All
five are fixture-backed.
`PROVIDER_APPENDED_ZONE_NAME` now also covers an alias whose *target* was
appended to, which is a value the customer pasted correctly and must not read as
pointing somewhere else on purpose.

Both kinds repeat within a profile, so `CheckOutcome` gains `records`, keyed by
label the way `selectors` is keyed by selector. Two requirements resolving to one
label are now refused when a domain supplies the values, and attribution returns
nothing rather than the first match when it cannot tell two apart — previously
the second requirement inherited the first's verdict, which could report a
domain verified for a token nobody published. That last part fixes the same
latent hole for DKIM selectors. `propgate check` gains `--token`,
`--token-at` and `--cname <label>=<target>`, and refuses `--only ownership` or
`--only cname` with nothing to compare against rather than reporting nothing.
