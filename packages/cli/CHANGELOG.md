# @propgate/cli

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
