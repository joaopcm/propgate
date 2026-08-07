# @propgate/cli

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
