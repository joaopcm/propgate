# @propgate/cli

DNS diagnosis from the terminal. Tells you *why* a domain's mail configuration
is wrong, not just that a lookup failed.

Zero runtime dependencies beyond [`@propgate/dns`](https://www.npmjs.com/package/@propgate/dns),
which has none of its own. MIT licensed. Part of
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
  --caa-issuer <name>   A certificate authority that must be authorised.
  --receives-mail       This domain should receive mail, so undeliverable mail
                        is a problem. Unstated by default.
  --only <kinds>        Comma-separated: delegation, spf, dkim, dmarc, mx, caa.
  --resolver <addr>     Resolver to query, as address or address:port.
                        Defaults to the system resolver.
  --trace               Print every DNS query behind the answer.
  --json                Machine-readable output.
  --help, --version
```

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

## Related

- [`@propgate/dns`](https://www.npmjs.com/package/@propgate/dns) — the library
- [docs.propgate.dev/taxonomy](https://docs.propgate.dev/taxonomy) — every
  diagnosis code
- [docs.propgate.dev/conformance](https://docs.propgate.dev/conformance) —
  which parts of which RFCs are asserted by a test
