# @propgate/cli

DNS diagnosis from the terminal. Tells you *why* a domain's mail configuration
is wrong, not just that a lookup failed.

Built on [`@propgate/dns`](https://www.npmjs.com/package/@propgate/dns), which
has zero runtime dependencies of its own. MIT licensed. Part of
[propgate](https://github.com/joaopcm/propgate).

```sh
npx @propgate/cli check example.com
```

## What it tells you

Every output below is a real run.

```sh
npx @propgate/cli check github.com --only spf
```

```
github.com

   ! spf
    - Part of this domain's SPF record changes for every connection, so it
      cannot be checked from the published records alone.
      %{i} needs something this check does not have
      found:  exists:%{i}._spf.mta.salesforce.com
      SPF_MACRO_NOT_EVALUATED
    ! This domain's SPF record is close to the ten-lookup limit, so adding one
      more sending service is likely to break it.
      0 of the ten lookups are left, so the next sending service added is
      likely to break SPF outright
      found:  10 lookups
      wanted: at most 7 lookups, to leave room to grow
      SPF_LOOKUP_LIMIT_NEAR

1 thing worth looking at
```

GitHub's SPF record works today and sits at exactly the ten DNS lookups RFC 7208
allows. The next `include:` anyone adds breaks mail delivery, with no error at
the moment of the edit. Finding that needs recursive `include:` expansion with
the lookup and void-lookup limits actually counted — a regex over a TXT record
cannot do it.

Asserting something specific:

```sh
npx @propgate/cli check example.com --only spf --spf-include _spf.google.com
```

```
   x spf
    x This domain's SPF record does not authorise the sending service being
      set up, so its messages will fail SPF.
      add include:_spf.google.com before the all mechanism; added after it,
      the term never runs
      found:  no include: or redirect= terms at all
      wanted: include:_spf.google.com
      SPF_SOURCE_NOT_AUTHORIZED

1 problem to fix
```

Every finding carries a stable
[diagnosis code](https://docs.propgate.dev/taxonomy), what was **found**, and
what was **wanted**.

## Usage

```
propgate check <domain> [options]

  --selector <name>     A DKIM selector to check. Repeatable.
  --spf-include <name>  An include: token that must authorise this domain.
  --caa-issuer <ca>     A certificate authority that must be authorised.
  --receives-mail       This domain should receive mail, so undeliverable mail
                        is a problem. Unstated by default.
  --only <values>       One of: delegation, spf, dkim, dmarc, mx, caa.
  --resolver <addr>     Resolver to query, as address or address:port.
                        Defaults to the system resolver.
  --trace               Print every DNS query behind the answer.
  --remote              Ask the propgate API instead of resolving here.
  --json                Machine-readable output.
  --help, --version
```

`propgate --help` lists every command; `propgate <command> --help` describes
one. Both are generated from the command definitions, so neither can describe a
flag that does not exist.

`--receives-mail` is worth understanding. Whether a null MX is correct depends
entirely on intent, and no amount of looking at DNS reveals it — so the flag is
tri-state. Leave it off and the check makes no claim; pass it and undeliverable
mail becomes a failure.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Nothing to fix. Warnings count as nothing to fix — they describe something that works |
| `1` | Something is wrong |
| `2` | A check could not be completed, which is **not** the same as a failure |
| `64` | The arguments were wrong. Nothing was attempted |
| `130` | Cancelled at a prompt |

That third code is the one that matters in a pipeline. A resolver that timed out
says nothing about the domain, and treating it as a failure is how a deployment
gate starts blocking releases over someone else's bad second.

```sh
npx @propgate/cli check "$DOMAIN" --only spf,dkim --selector app || exit $?
```

## `--json`

```sh
npx @propgate/cli check example.com --only dmarc --json
```

```json
{
  "checks": [
    {
      "findings": [],
      "kind": "dmarc",
      "lookups": [
        {
          "name": "_dmarc.example.com",
          "purpose": "the domain's own DMARC policy",
          "server": "1.1.1.1:53",
          "status": "answered",
          "type": 16
        }
      ],
      "verdict": "pass"
    }
  ],
  "domain": "example.com",
  "verdict": "pass"
}
```

Results carry their **derivation**: which lookups happened, against which
server, and what each returned. A verdict you cannot audit is a verdict you have
to take on faith. `--trace` prints the same thing in human form.

## What it checks

| Check | What it means |
|---|---|
| `delegation` | Every nameserver answers authoritatively and agrees. Catches lame delegations and stale NS records, which look like intermittent outages to everyone else |
| `spf` | Recursive `include:` expansion the way an MTA does it, with the RFC 7208 ten-lookup and two-void-lookup limits enforced |
| `dkim` | The selector publishes a valid, usable key — parsed, not pattern-matched |
| `dmarc` | A valid policy, discovered at the right name, with external report authorisation checked per RFC 7489 |
| `mx` | Mail is deliverable, or correctly declared undeliverable |
| `caa` | The CAA tree authorises a named certificate authority, climbed per RFC 8659 |

## Why a separate resolver

The engine underneath does not use `node:dns`. c-ares cannot expose the TC bit,
set the DO bit, return RRSIGs, or preserve the difference between REFUSED,
SERVFAIL and NXDOMAIN — and each of those is a diagnosis this tool reports.
See [`@propgate/dns`](https://www.npmjs.com/package/@propgate/dns) for the
detail.

## Managing an account

`check` needs no account and never talks to propgate — it resolves against
whichever resolver you point it at. Everything in this section talks to
[api.propgate.dev](https://api.propgate.dev) instead, and is the only part that
needs a key.

```sh
npx @propgate/cli signup --email you@example.com
npx @propgate/cli confirm --email you@example.com --code 123456
```

In a terminal, `signup` goes on to ask for the code and finishes the job in one
command. `confirm` prints the key once and stores it in
`$XDG_CONFIG_HOME/propgate/config.json` at mode `0600`. There is no endpoint
that can show it again — only a hash is stored — so a lost key means running
the flow again, which mints an additional key against the same account rather
than a second account.

Every endpoint the API has has a command here. A spec in this package asserts
that both ways, so a route without a command is a failing test.

```sh
npx @propgate/cli keys list | create <name> | revoke <prefix|id>
npx @propgate/cli members list

npx @propgate/cli profiles create --key sending \
  --require 'spf:spf:include=_spf.google.com' \
  --require 'dkim:dkim:selector=google'
npx @propgate/cli profiles get sending

npx @propgate/cli domains add example.com --profile sending
npx @propgate/cli domains list --state failed --all
npx @propgate/cli domains get <id>
npx @propgate/cli domains check <id>
npx @propgate/cli domains timeline <id>
npx @propgate/cli domains delete <id>

npx @propgate/cli webhooks create --url https://example.com/hooks \
  --events domain.failed,domain.recovered
npx @propgate/cli webhooks list | get <id> | update <id> | delete <id>
npx @propgate/cli webhooks rotate <id> --window-hours 24
npx @propgate/cli webhooks deliveries <id> --status failed --all
```

`keys revoke` takes the prefix, which is the part of a key still readable after
it was issued. If a prefix matches more than one key it refuses and asks for an
id rather than guessing which one you meant.

`propgate check <domain>` reads DNS and writes nothing. `propgate domains check
<id>` re-checks a *registered* domain: it moves the domain's state and can fire
a webhook. They are different enough that `check` refuses a uuid and points at
the other rather than routing it.

## Two ways to run anything

Leave out a required flag and, if there is a terminal to ask in, it asks:

```
$ propgate domains add example.com

│  Which profile should this domain satisfy?
│  sending
│
example.com registered as 019fcf7a-....
```

Both paths come from one declaration per command — the flag and the question
are the same field — so they cannot describe different arguments.

When there is nobody to ask, it does not wait. It names every missing flag at
once and exits `64`:

```
$ CI=true propgate domains add example.com
propgate: domains add needs --profile.
Pass it, or run in a terminal without --json for the guided flow.
```

A CLI that blocks on stdin because a flag was missing hangs a build until the
runner's timeout with nothing saying why. Prompting is off when stdin or stdout
is not a TTY, when `--json` is passed, when `CI=true`, or when
`PROPGATE_NO_INPUT=1` — four checks because each catches a case the others
miss.

| Variable | |
|---|---|
| `PROPGATE_API_KEY` | Overrides the stored key. For CI, where no config file exists |
| `PROPGATE_API_URL` | Overrides the API base URL. `--api-url` beats both |
| `PROPGATE_NO_INPUT` | Set to `1` to never prompt |

## Related

- [`@propgate/dns`](https://www.npmjs.com/package/@propgate/dns) — the library
- [docs.propgate.dev/taxonomy](https://docs.propgate.dev/taxonomy) — every
  diagnosis code
- [docs.propgate.dev/conformance](https://docs.propgate.dev/conformance) —
  which parts of which RFCs are asserted by a test
