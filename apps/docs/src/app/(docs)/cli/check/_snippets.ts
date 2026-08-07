/**
 * `CHECK_USAGE` is `propgate check --help`, run against `packages/cli/dist/index.js`
 * while writing this page — it matches `USAGE` in `packages/cli/src/args.ts`
 * verbatim, which is the point: this is what a reader's terminal will print.
 *
 * `SPF_*`, `ASSERT_*` and `JSON_*` are the captures in `packages/cli/README.md`,
 * marked there as real runs against the live GitHub and example.com records —
 * not fabricated.
 */

export const CHECK_USAGE = `propgate check <domain> [options]

Diagnose a domain's DNS. Resolves locally by default and needs no account.

Argument
  <domain>  The domain to check.

Options
  --selector <name>     A DKIM selector to check. Repeatable.
  --spf-include <name>  An include: token that must authorise this domain.
  --caa-issuer <ca>     A certificate authority that must be authorised.
  --receives-mail       This domain should receive mail, so undeliverable mail
                        is a problem. Unstated by default.
  --only <values>       Only these checks. One of: delegation, spf, dkim, dmarc,
                        mx, caa.
  --resolver <addr>     Resolver to query, as address or address:port. Defaults
                        to the system resolver.
  --trace               Print every DNS query behind the answer.
  --remote              Ask the propgate API instead of resolving here. Needs no
                        account.
  --json                Machine-readable output. Implies no prompting.

Examples
  propgate check example.com --only spf,dkim --selector k1
  propgate check example.com --remote`;

export const SPF_RUN = "npx @propgate/cli check github.com --only spf";

export const SPF_OUTPUT = `github.com

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

1 thing worth looking at`;

export const ASSERT_RUN =
  "npx @propgate/cli check example.com --only spf --spf-include _spf.google.com";

export const ASSERT_OUTPUT = `   x spf
    x This domain's SPF record does not authorise the sending service being
      set up, so its messages will fail SPF.
      add include:_spf.google.com before the all mechanism; added after it,
      the term never runs
      found:  no include: or redirect= terms at all
      wanted: include:_spf.google.com
      SPF_SOURCE_NOT_AUTHORIZED

1 problem to fix`;

export const JSON_RUN =
  "npx @propgate/cli check example.com --only dmarc --json";

export const JSON_OUTPUT = `{
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
}`;

export const CI_GATE_RUN =
  "npx @propgate/cli check example.com --only spf,dkim --selector app || exit $?";

export const REMOTE_RUN = "npx @propgate/cli check example.com --remote";

export const REDIRECT = `$ propgate check 019fcf4f-2b3c-7d4e-9f5a-6b7c8d9e0f1a
propgate: that looks like a domain id, not a domain name.
Did you mean \`propgate domains check 019fcf4f-2b3c-7d4e-9f5a-6b7c8d9e0f1a\`?`;
