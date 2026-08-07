---
"@propgate/dns": patch
"@propgate/cli": patch
---

Catch the published READMEs up with the ownership and cname checks, and guard
the numbers in them against the code.

`@propgate/dns` claimed six evaluators and a 73-code taxonomy over a package with
eight and 78; `@propgate/cli` listed a `--only` set missing two kinds and three
flags that exist. Both are the first thing a reader sees on npm.

Neither number is asserted by a spec, which is why both survived the change that
falsified them — so both now are. `readme.spec.ts` in each package reads its own
README and fails if the count, the evaluator list, or the flag list disagrees
with the registry it describes, the same way `apps/docs` already guards its
pasted `--help` against the real one.
