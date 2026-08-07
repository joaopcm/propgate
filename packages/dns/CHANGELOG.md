# @propgate/dns

## 0.4.0

### Minor Changes

- [#87](https://github.com/joaopcm/propgate/pull/87) [`baf8564`](https://github.com/joaopcm/propgate/commit/baf8564137b29cd320e1ab4430c86cddb11f6004) Thanks [@joaopcm](https://github.com/joaopcm)! - Add the `ownership` and `cname` checks — the two record kinds `docs/DESIGN.md`
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
  _added_ our record beside their previous vendor's leaves one of ours and one of
  theirs. Resolvers hand out the whole set, so requests split between us and a
  host we have never heard of — which reads as "it works sometimes" and is
  reported as `CNAME_TARGET_PARTIAL`.

  For the same reason both address families are always queried, on both sides of
  that comparison, rather than falling back to AAAA only when A is empty. A name
  carrying our A record and a stale AAAA has a stranger that an A-first lookup
  never sees, and it routes every IPv6 client to it. The two queries run
  concurrently, so the cost is a query rather than a round trip, and it lands only
  on names with no CNAME — a correctly published alias is still one lookup.

  New diagnosis codes: `OWNERSHIP_TOKEN_MISSING`, `OWNERSHIP_TOKEN_MISMATCH`,
  `CNAME_RECORD_MISSING`, `CNAME_TARGET_MISMATCH`, `CNAME_TARGET_PARTIAL`. All
  five are fixture-backed.
  `PROVIDER_APPENDED_ZONE_NAME` now also covers an alias whose _target_ was
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

## 0.3.0

### Minor Changes

- [#67](https://github.com/joaopcm/propgate/pull/67) [`ff0ea29`](https://github.com/joaopcm/propgate/commit/ff0ea29f83958aa8f2a4f597feb28c1ad0a61e4f) Thanks [@joaopcm](https://github.com/joaopcm)! - **`@propgate/cli`: account and domain management from the terminal.**

  ```sh
  propgate signup  --email you@example.com
  propgate confirm --email you@example.com --code 123456
  propgate keys list | keys create <name> | keys revoke <prefix>
  propgate domains add <domain> --profile <key> | domains list
  ```

  `confirm` stores the key in `$XDG_CONFIG_HOME/propgate/config.json` at mode
  `0600` and prints it once. `PROPGATE_API_KEY` overrides it for CI;
  `PROPGATE_API_URL` and `--api-url` point it at another stack.

  `propgate check` is unchanged and still needs no account, no config file and no
  network beyond DNS.

  Also fixes `--version`, which printed the usage text in every release that has
  shipped: the flag arrives with no positionals, and the "no arguments means help"
  branch was checked first. The version is now read from `package.json` rather than
  a second hardcoded copy, so it cannot drift from the published one again.

  **`@propgate/dns`: `TCP_SILENTLY_BLOCKED` is now emitted.**

  A truncated UDP answer whose TCP retry is swallowed — the shape of a middlebox
  blocking TCP port 53, which reads to everyone else as an intermittent outage
  because the record and the server are both fine while a 2048-bit DKIM key never
  arrives.

  It fires only when the same server answered over UDP and set the TC bit first. A
  bare TCP timeout does not qualify: the server may simply be dead, and saying
  "something is blocking TCP" about a dead host would be a guess. The verdict stays
  `indeterminate` rather than `fail`, because a blocked retry means the key may well
  be published and merely unreachable at this size.

  `QueryOutcome`'s `timeout` variant carries a new `retriedOverTcp` field, which is
  what makes that distinction expressible. Additive for anything reading an outcome;
  code that _constructs_ one will need the field.

## 0.2.0

### Minor Changes

- [#34](https://github.com/joaopcm/propgate/pull/34) [`bc4b70e`](https://github.com/joaopcm/propgate/commit/bc4b70e6093fac99b394499741da9abf49203325) Thanks [@joaopcm](https://github.com/joaopcm)! - DKIM outcomes now carry per-selector detail, and a selector can name the key it
  should be publishing.

  `CheckOutcome.selectors` appears on the `dkim` outcome and lists each selector's
  own findings, lookups and verdict. The merged verdict is unchanged — "is DKIM
  set up" is still one question with one answer — but a platform that issued three
  keys can now tell which of them is missing, which a merged answer cannot express.

  `DomainProfile.dkimSelectors` accepts `{ selector, expectedPublicKey }` as well
  as a bare string. The bare string asks whether a valid key is published; the
  object asks whether _your_ key is, which is what catches a domain that pasted
  someone else's record. Passing strings keeps working exactly as before.

## 0.1.0

### Minor Changes

- [#24](https://github.com/joaopcm/propgate/pull/24) [`b474ad0`](https://github.com/joaopcm/propgate/commit/b474ad048eab97569d5dcfaa0469557937f11265) Thanks [@joaopcm](https://github.com/joaopcm)! - `propgate check <domain>` — the same engine as the public checker and the API,
  run from a terminal against whichever resolver you are actually using.

  Exit codes carry the distinction the resolver works to preserve: `0` nothing to
  fix, `1` something is wrong, `2` a check could not be completed. Collapsing the
  last two would fail a deploy over a resolver blip, which is exactly what the
  four-valued verdict exists to prevent.

  `DomainProfile.expectsMail` is now optional, with three states rather than two.
  Undeliverable mail is only a fault if someone said the domain should receive it,
  and defaulting to `true` reported every correctly configured sending-only domain
  as broken. A caller who does not say is no longer assumed to have said anything.

- [#28](https://github.com/joaopcm/propgate/pull/28) [`10ca205`](https://github.com/joaopcm/propgate/commit/10ca205c469588cb06cb315fcd1904796de8682b) Thanks [@joaopcm](https://github.com/joaopcm)! - Three codes that were published but that nothing could ever produce now fire:
  `NODATA_NOT_NXDOMAIN`, `NEGATIVE_CACHE_LIKELY` and `TRUNCATED_FELL_BACK_TO_TCP`.
  A negative answer now says what _kind_ of nothing came back — whether the name
  exists, and how long the absence will be remembered.

  `NOT_YET_EMITTED` and its guard make the general case impossible to repeat: a
  code must be reported by an evaluator or listed with the reason it is not, and
  the reason must say what it would take.

- [#21](https://github.com/joaopcm/propgate/pull/21) [`5b371c6`](https://github.com/joaopcm/propgate/commit/5b371c6260ee954e2473dde85e0e9a932efc5ebc) Thanks [@joaopcm](https://github.com/joaopcm)! - `runChecks` composes the six evaluators into one result, against a
  `DomainProfile` that states what the domain is for.

  Checks run concurrently with their own contexts, so the wall clock is the
  slowest check rather than the sum. A check the profile does not ask for
  produces no outcome at all rather than a passing one — six ticks for a domain
  that was asked about two is a lie a dashboard should not be able to tell.

- [#26](https://github.com/joaopcm/propgate/pull/26) [`c6b9d3d`](https://github.com/joaopcm/propgate/commit/c6b9d3d42ad025a65d19fd6a0a26f439220eeb74) Thanks [@joaopcm](https://github.com/joaopcm)! - A published RFC conformance ledger: which normative requirements this library
  implements, which it does not, and why.

  `REQUIREMENTS`, `summary()` and `coverageByRfc()` are exported so a consumer can
  assert against the same table the build enforces. Every requirement marked
  implemented names a test that must exist and must assert it — the figure is
  checkable rather than claimed.

- [#20](https://github.com/joaopcm/propgate/pull/20) [`8fd9799`](https://github.com/joaopcm/propgate/commit/8fd9799713322c037ccddfc4fdc854e35c90f600) Thanks [@joaopcm](https://github.com/joaopcm)! - First release with any behaviour in it. The published 0.0.0 was the empty
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

- [#29](https://github.com/joaopcm/propgate/pull/29) [`7eaae72`](https://github.com/joaopcm/propgate/commit/7eaae72ad4117fff52077e5e79f04b76b478bf80) Thanks [@joaopcm](https://github.com/joaopcm)! - `RRSET_TTL_MISMATCH`: records that belong together carrying different lifetimes,
  so part of the set expires before the rest and the answer changes shape with
  nothing having been edited (RFC 2181 §5.2).

  Three requirements catalogued that were implemented and untested: SPF's
  evaluation time limit, EDNS(0) buffer advertisement, and truncation above the
  advertised size.

### Patch Changes

- [#22](https://github.com/joaopcm/propgate/pull/22) [`c619ea5`](https://github.com/joaopcm/propgate/commit/c619ea586c7c0daa2130c7bb8ff34ce56090fd8e) Thanks [@joaopcm](https://github.com/joaopcm)! - `ServerAddress`, `Finding`, `Lookup` and the check pipeline's types are exported
  from the package entry point, so a consumer can type a response without
  reaching into `dist`.

- [#27](https://github.com/joaopcm/propgate/pull/27) [`8fc4f78`](https://github.com/joaopcm/propgate/commit/8fc4f78b7d4141ed2249704d4bc9244e1ac1a8c3) Thanks [@joaopcm](https://github.com/joaopcm)! - Fix a false positive: a DKIM key split across TXT character-strings and rejoined
  with whitespace was reported as malformed. RFC 6376 §2.10 permits folding
  whitespace at arbitrary places inside a base64 value, and every 2048-bit key is
  split by necessity — so this told a customer their working key was broken.

  `TXT_VALUE_SPLIT_MANGLED` now fires on a rejoin that is actually a rejoin: the
  `v=DKIM1` prefix repeated on every chunk.
