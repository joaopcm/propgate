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

New diagnosis codes: `OWNERSHIP_TOKEN_MISSING`, `OWNERSHIP_TOKEN_MISMATCH`,
`CNAME_RECORD_MISSING`, `CNAME_TARGET_MISMATCH`. All four are fixture-backed.
`PROVIDER_APPENDED_ZONE_NAME` now also covers an alias whose *target* was
appended to, which is a value the customer pasted correctly and must not read as
pointing somewhere else on purpose.

Both kinds repeat within a profile, so `CheckOutcome` gains `records`, keyed by
label the way `selectors` is keyed by selector. `propgate check` gains `--token`,
`--token-at` and `--cname <label>=<target>`, and refuses `--only ownership` or
`--only cname` with nothing to compare against rather than reporting nothing.
