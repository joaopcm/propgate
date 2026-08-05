---
"@propgate/dns": minor
"@propgate/cli": minor
---

**`@propgate/cli`: account and domain management from the terminal.**

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
code that *constructs* one will need the field.
