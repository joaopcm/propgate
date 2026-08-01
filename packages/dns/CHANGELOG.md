# @propgate/dns

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
