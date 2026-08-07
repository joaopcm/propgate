# @propgate/cli

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

### Patch Changes

- [#89](https://github.com/joaopcm/propgate/pull/89) [`37d5aa8`](https://github.com/joaopcm/propgate/commit/37d5aa8b65a79656886da59c302839fd14a31188) Thanks [@joaopcm](https://github.com/joaopcm)! - `webhooks create` accepts an `http://` URL on loopback.

  The https rule is a statement about a network, and loopback has none — the same
  line browsers draw when they treat `http://127.0.0.1` as a secure context.
  Refusing it client-side meant the CLI could never register a receiver against a
  self-hosted API, because the check runs before any request is made and the CLI
  has no way to know what the server on the other end permits. api.propgate.dev
  still refuses loopback outright, so nothing changes for anyone pointed at us:
  the final say moves to the server, which is the only side that knows.

- Updated dependencies [[`baf8564`](https://github.com/joaopcm/propgate/commit/baf8564137b29cd320e1ab4430c86cddb11f6004)]:
  - @propgate/dns@0.4.0

## 0.3.0

### Minor Changes

- [#83](https://github.com/joaopcm/propgate/pull/83) [`fd09c29`](https://github.com/joaopcm/propgate/commit/fd09c29aaa464864687a4ab8ab249f62093f3132) Thanks [@joaopcm](https://github.com/joaopcm)! - **`domains add --expect` supplies the values a profile requires per domain.**

  A profile can now name fields it expects each domain to supply rather than
  fixing them for every domain at once — `requiredPerDomain: ["expectedPublicKey"]`
  on a DKIM requirement says _there must be a key at this selector_, and leaves
  _which key_ to the domain. Registering against such a profile without those
  values is refused with a `422` naming the path it wanted.

  `--expect` supplies them, repeatable, using the API's own field names:

  ```sh
  propgate domains add acme.com --profile sending \
    --expect 'dkim.expectedPublicKey=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...'
  ```

  The value is split on the **first** `=` and the **last** `.`. Neither is
  arbitrary: a base64 DKIM key ends in `=` or `==`, so splitting on every equals
  sign would truncate the one value this flag exists for, and a requirement key
  may contain a dot while a field name never does. A `<requirement>.<field>` given
  twice is an error rather than last-one-wins — a typo and a genuine second value
  look identical here, and quietly dropping one is how a domain ends up verified
  against the wrong key.

- [#83](https://github.com/joaopcm/propgate/pull/83) [`fd09c29`](https://github.com/joaopcm/propgate/commit/fd09c29aaa464864687a4ab8ab249f62093f3132) Thanks [@joaopcm](https://github.com/joaopcm)! - **Every API endpoint is now a command, and every command works two ways.**

  The CLI reached 7 of the API's 22 endpoints. It now reaches all 22 — the whole
  webhooks family, both profiles endpoints, `members list`, `domains
get`/`check`/`timeline`/`delete`, and `check --remote` for the public checker.
  A spec asserts the parity in both directions, so a route without a command
  fails a test rather than going unnoticed.

  Each argument is declared once and drives both the flag and the prompt, so the
  scripted path and the guided path cannot describe different things. Leave out a
  required flag and, if there is a terminal to ask in, it asks:

  ```
  $ propgate domains add example.com

  │  Which profile should this domain satisfy?
  │  sending
  │
  example.com registered as 019fcf7a-….
  ```

  When there is nobody to ask it does not wait — it names every missing flag at
  once and exits `64`. A CLI that blocks on stdin because a flag was missing hangs
  a build until the runner's timeout with nothing saying why:

  ```
  $ CI=true propgate domains add example.com
  propgate: domains add needs --profile.
  Pass it, or run in a terminal without --json for the guided flow.
  ```

  Prompting is off when stdin or stdout is not a TTY, when `--json` is passed,
  when `CI=true`, or when `PROPGATE_NO_INPUT=1`.

  New and changed flags:

  - `propgate check <domain> --remote` asks the API instead of resolving locally.
    Local stays the default: it answers from _your_ resolver's point of view,
    which is usually the more useful answer when a customer reports something odd.
  - `propgate profiles create` takes `--require '<key>:<check>[:field=value]'`,
    repeatable, or `--file` (with `-` for stdin). Field names are the API's own,
    unaliased, so a `422` names the word you typed.
  - `domains list` gains `--external-id`, `--cursor` and `--limit`; it and
    `webhooks deliveries` gain `--all`, which follows the cursor to the end at the
    server's maximum page size.

  Two commands do different things and the CLI keeps them apart. `propgate check`
  reads DNS and writes nothing. `propgate domains check <id>` re-checks a
  _registered_ domain: it moves the domain's state, spends the per-tenant check
  budget, and a transition there is what fires a webhook. So a domain id typed at
  `propgate check` is redirected rather than routed, and nothing goes over the
  wire either way:

  ```
  $ propgate check 019fcf4f-2b3c-7d4e-9f5a-6b7c8d9e0f1a
  propgate: that looks like a domain id, not a domain name.
  Did you mean `propgate domains check 019fcf4f-2b3c-7d4e-9f5a-6b7c8d9e0f1a`?
  ```

  **Two behaviour changes worth reading before upgrading.** A missing required
  argument now exits **64** rather than `1`. `1` means the API said no; `64` means
  the arguments were wrong and nothing was attempted, and a script could not tell
  a typo from a rejection while both were `1`. A prompt cancelled with Ctrl-C
  exits **130**. `--json` now implies no prompting everywhere.

  `@propgate/cli` gains one dependency, `@clack/prompts`, for the guided flow. It
  is loaded only when there is a person to prompt, so `propgate check` never
  reaches it — and `@propgate/dns`, the resolver underneath, still has zero
  runtime dependencies of its own.

## 0.2.1

### Patch Changes

- [#69](https://github.com/joaopcm/propgate/pull/69) [`e854918`](https://github.com/joaopcm/propgate/commit/e8549188b4531173938eb46df8c2d4e1dd88a0e5) Thanks [@joaopcm](https://github.com/joaopcm)! - **Fix the CLI doing nothing at all when run through its `bin`.**

  `npx @propgate/cli check example.com` — the invocation in the README — exited 0
  and printed nothing. So did every other command. This affected `0.1.0`, `0.1.1`,
  `0.1.2` and `0.2.0`: every version ever published.

  The entry guard asked whether `process.argv[1]` ended in `index.js`, to stay
  importable from specs. But npm installs a package's bin as a symlink —
  `.bin/propgate` → `dist/index.js` — and Node reports `argv[1]` as the path it was
  invoked by rather than the file that path resolves to. Through the symlink the
  guard saw `.../.bin/propgate`, concluded it was being imported, and skipped
  `main()` entirely.

  It compares realpaths now, which holds for the POSIX symlink, for
  `node dist/index.js` with a relative path, and for the Windows `.cmd` shim.

  Nothing else changed. Running `node dist/index.js` directly always worked, which
  is why this survived four releases and a green suite — so the regression test
  invokes the built binary **through a symlink**, the one shape nothing covered.

## 0.2.0

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

### Patch Changes

- Updated dependencies [[`ff0ea29`](https://github.com/joaopcm/propgate/commit/ff0ea29f83958aa8f2a4f597feb28c1ad0a61e4f)]:
  - @propgate/dns@0.3.0

## 0.1.2

### Patch Changes

- [#43](https://github.com/joaopcm/propgate/pull/43) [`b3ee525`](https://github.com/joaopcm/propgate/commit/b3ee5259e6b55442eb47925bd179255cf86809f1) Thanks [@joaopcm](https://github.com/joaopcm)! - Add a README, so the npm page documents the tool rather than showing nothing:
  what each check means, every flag, the three exit codes and why the third one
  matters in a pipeline, and real output rather than invented examples.

## 0.1.1

### Patch Changes

- Updated dependencies [[`bc4b70e`](https://github.com/joaopcm/propgate/commit/bc4b70e6093fac99b394499741da9abf49203325)]:
  - @propgate/dns@0.2.0

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

### Patch Changes

- Updated dependencies [[`b474ad0`](https://github.com/joaopcm/propgate/commit/b474ad048eab97569d5dcfaa0469557937f11265), [`c619ea5`](https://github.com/joaopcm/propgate/commit/c619ea586c7c0daa2130c7bb8ff34ce56090fd8e), [`10ca205`](https://github.com/joaopcm/propgate/commit/10ca205c469588cb06cb315fcd1904796de8682b), [`8fc4f78`](https://github.com/joaopcm/propgate/commit/8fc4f78b7d4141ed2249704d4bc9244e1ac1a8c3), [`5b371c6`](https://github.com/joaopcm/propgate/commit/5b371c6260ee954e2473dde85e0e9a932efc5ebc), [`c6b9d3d`](https://github.com/joaopcm/propgate/commit/c6b9d3d42ad025a65d19fd6a0a26f439220eeb74), [`8fd9799`](https://github.com/joaopcm/propgate/commit/8fd9799713322c037ccddfc4fdc854e35c90f600), [`7eaae72`](https://github.com/joaopcm/propgate/commit/7eaae72ad4117fff52077e5e79f04b76b478bf80)]:
  - @propgate/dns@0.1.0
