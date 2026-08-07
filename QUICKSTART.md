# Quickstart

Every command here was run against the live API and the outputs are real,
including the unflattering ones. The one exception is the signup exchange below,
which ends in a mailbox rather than on a terminal — its request and response
shapes come from the code, and it is marked where it appears.

```sh
export A=https://api.propgate.dev
alias j='python3 -m json.tool'      # or jq
```

## No key required

`POST /v1/checks` is open. One field, no signup.

```sh
curl -s -X POST $A/v1/checks -H 'content-type: application/json' \
  -d '{"domain":"example.com"}' | j
```

```
delegation  pass
spf         pass
dmarc       pass
mx          pass    MX_NULL
```

`MX_NULL` on a **passing** check is the first thing worth understanding: the
domain declares it accepts no mail, which is correct rather than broken. Read
`satisfied`, not the presence of findings.

### What a real domain looks like

```sh
curl -s -X POST $A/v1/checks -H 'content-type: application/json' \
  -d '{"domain":"github.com"}' | j
```

```
delegation  warn    NS_SERIAL_MISMATCH
spf         warn    SPF_MACRO_NOT_EVALUATED, SPF_LOOKUP_LIMIT_NEAR
dmarc       pass
mx          pass
```

Two findings on a domain nobody would call misconfigured, and neither is the
kind of thing a hand-rolled verifier looks for.

**Their SPF has no room left.**

```json
{
  "code": "SPF_LOOKUP_LIMIT_NEAR",
  "evidence": {
    "detail": "0 of the ten lookups are left, so the next sending service added is likely to break SPF outright",
    "expected": "at most 7 lookups, to leave room to grow",
    "observed": "10 lookups"
  }
}
```

RFC 7208 caps SPF evaluation at ten DNS lookups. GitHub is at exactly ten. The
record works today and the next `include:` anyone adds breaks mail delivery,
with no error at the moment of the edit. Finding this needs recursive `include:`
expansion, which is why a regex over a TXT record is not a verifier.

**Their nameservers disagree.**

```json
{
  "code": "NS_SERIAL_MISMATCH",
  "evidence": {
    "detail": "a zone transfer has stopped: every answer is valid, some are simply older, and which one a customer sees depends on which server they reach",
    "observed": "ns-520.awsdns-01.net, … at 1; dns1.p08.nsone.net, … at 1656468023"
  }
}
```

Two nameserver sets, two different zone serials. Every answer is valid; some are
older. Which one a customer gets depends on which server they happen to reach —
the class of problem that reads as "intermittent" and never reproduces.

Every finding carries a [diagnosis code](https://docs.propgate.dev/taxonomy),
a `slug` linking to its documentation, and the lookups behind it.

## Getting a key

Two calls, no sales conversation. **Shapes from the code rather than a captured
run** — the middle step is reading your mail.

```sh
curl -s -X POST $A/v1/signup -H 'content-type: application/json' \
  -d '{"email":"you@example.com"}' | j
```

```json
{ "data": { "object": "signup", "status": "pending" }, "error": null, "meta": null }
```

A six-digit code arrives, valid for ten minutes. That response is identical
whether or not the address already has an account — a signup endpoint that says
*already registered* tells whoever holds a leaked address list which of those
addresses use us.

```sh
curl -s -X POST $A/v1/signup/confirm -H 'content-type: application/json' \
  -d '{"email":"you@example.com","code":"123456"}' | j
```

```json
{
  "data": {
    "apiKey": "pg_live_...",
    "created": true,
    "object": "account",
    "tenantId": "019fcf4f-..."
  },
  "error": null,
  "meta": null
}
```

That is the only time the key is readable. Only a hash is stored, so no endpoint
can show it again — losing it means running the flow again, which mints an
*additional* key against the same account rather than a second account. That
doubles as the recovery path, which is why there is no separate sign-in.

The code is single-use: a second `confirm` with it returns `409`.

Or let the CLI hold it for you:

```sh
npx @propgate/cli signup  --email you@example.com
npx @propgate/cli confirm --email you@example.com --code 123456
```

`confirm` stores the key in `$XDG_CONFIG_HOME/propgate/config.json` at mode
`0600` and prints it once. `PROPGATE_API_KEY` overrides it for CI.

## With a key

Registration and verification are separate calls. Registration is a write;
verification is an action with latency. Importing ten thousand domains should
not fire ten thousand DNS runs as a side effect of a bulk insert.

```sh
export KEY=pg_live_...        # from `confirm` above
```

### A profile: what you expect of a domain

```sh
curl -s -X POST $A/v1/profiles -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{
    "key": "sending",
    "requirements": [
      { "key": "ns",    "check": "delegation" },
      { "key": "spf",   "check": "spf", "include": "_spf.google.com" },
      { "key": "dkim",  "check": "dkim", "selector": "google",
        "requiredPerDomain": ["expectedPublicKey"] },
      { "key": "dmarc", "check": "dmarc" },
      { "key": "mail",  "check": "mx", "expectsMail": true }
    ]
  }' | j
```

Editing a profile writes a **new version**; it never changes the old one, and
domains stay pinned to the version they were registered against. Otherwise one
edit silently reclassifies every domain at once.

A definition is refused at write time if any requirement could never be
answered — a duplicate key, a DKIM requirement with neither a selector nor one
required per domain, a CAA requirement with no issuer. Accepting those would be a
promise this API could not keep.

`requiredPerDomain` is the shape/value split. The profile says *there must be a
DKIM key at the `google` selector*; each domain says *and here is the one we
issued it*. Anything a platform hands out per domain belongs there —
`expectedPublicKey`, `selector`, `include`, `caaIssuer` — and everything that is
the same for every domain stays in the profile, like the `include` above. Without
it, ten thousand domains with ten thousand keys means ten thousand profiles.

Supplying the key is what turns "a valid key is published" into "*your* key is
published", which is the difference between passing a domain that pasted a
competitor's record and catching it.

### Register, then verify

```sh
curl -s -X POST $A/v1/domains -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{
    "name": "yourdomain.dev",
    "profile": "sending",
    "externalId": "cust_1",
    "expectations": {
      "dkim": { "expectedPublicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A..." }
    }
  }' | j

export ID=$(curl -s "$A/v1/domains?externalId=cust_1" -H "authorization: Bearer $KEY" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"][0]["id"])')

curl -s -X POST $A/v1/domains/$ID/checks -H "authorization: Bearer $KEY" | j
```

```json
{
  "state": "failed",
  "verdict": "fail",
  "requirementsMet": 3,
  "requirementsTotal": 5,
  "requirements": [
    { "key": "spf",  "satisfied": true,  "verdict": "pass", "findings": [] },
    { "key": "dkim", "satisfied": false, "verdict": "fail",
      "findings": [
        { "code": "DKIM_RECORD_MISSING",
          "name": "google._domainkey.yourdomain.dev" }
      ] }
  ]
}
```

"3 of 5 met", the unmet ones named, and the DNS name the missing record belongs
at. No instructions are rendered — you already have a UI that tells your
customer what to paste, and being wrong about a provider's naming conventions is
visible to your customer rather than to us.

Omit a value your profile requires and the registration is refused, naming the
path to set:

```json
{ "error": { "message": "profile \"sending\" requires expectations.dkim.expectedPublicKey, which was not supplied" } }
```

That is deliberately a 422 rather than a domain that registers and reports
`indeterminate` forever. A domain nobody can judge is worse than a request that
failed, because you find out about the first one from a dashboard days later.

### Rotating a key

```sh
curl -s -X PATCH $A/v1/domains/$ID -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{
    "expectations": { "dkim": { "expectedPublicKey": "MIIBIjANBgkq...NEW" } }
  }' | j
```

The domain goes back to `pending`, its failure run resets, and **no webhook
fires**. The value we compare against changed because you changed it, not because
your customer's DNS moved — and a `domain.failed` on ten thousand domains mid-
rotation would page ten thousand people for nothing. The next sweep verifies
against the new key and reports normally. Nothing is appended to the timeline for
that first check either, for the same reason: it would read as "the DKIM record
changed" about a zone that did not change.

Zero-downtime rotation is a **second selector** rather than a swapped value: add a
`dkim` requirement for the new selector in a new profile version, `PATCH` the
domain onto it with `{"profile": "sending"}`, and retire the old one once DNS has
caught up. Several `dkim` requirements per profile is the one repeatable
requirement type, and this is what it is for.

`PATCH` also takes `profile` on its own, which is how a customer moves from one
profile to another — an upgrade from sending-only to full mail is the same
operation as a rotation, and gets the same reset. Re-pointing to a profile whose
requirements your stored values cannot satisfy is refused, and the domain is left
alone.

### Read it back, and watch it change

```sh
curl -s $A/v1/domains/$ID -H "authorization: Bearer $KEY" | j          # stored, no re-check
curl -s $A/v1/domains/$ID/timeline -H "authorization: Bearer $KEY" | j
```

Check twice in a row and the timeline does not grow. An entry is appended **only
when an observation actually differs** — that is the difference between a $20
infrastructure bill and a $400 one, and it cannot be retrofitted.

Fix the missing record, wait for the TTL, check again, and one entry appears:

```json
{ "requirementKey": "dkim",
  "previous": "fail:DKIM_RECORD_MISSING",
  "current": "pass",
  "observedAt": "2026-08-03T14:02:11.000Z" }
```

### List and reconcile

```sh
curl -s "$A/v1/domains?limit=200" -H "authorization: Bearer $KEY" | j
curl -s "$A/v1/domains?state=failed" -H "authorization: Bearer $KEY" | j
curl -s "$A/v1/domains?externalId=cust_1" -H "authorization: Bearer $KEY" | j
```

Cursor paging, oldest first. Pass `meta.nextCursor` back until it is null;
domains registered while you walk land at the end rather than shifting pages.

## The verdict that is not a failure

```json
{ "verdict": "indeterminate", "state": "verified" }
```

A check that could not complete — an unreachable resolver, a timeout — changes
nothing. The domain keeps the state it had, `lastCheckedAt` moves, and nothing
is written to the timeline. Four verdicts rather than two, because "this is
broken" and "we could not tell" are different answers and collapsing them is how
a monitoring product pages someone at 3am over its own bad second.

## Errors

```sh
curl -s $A/v1/domains
# {"error":{"message":"missing Authorization header; expected `Authorization: Bearer pg_live_...`"}}

curl -s -X POST $A/v1/checks -H 'content-type: application/json' -d '{"domain":"co.uk"}'
# {"error":{"message":"\"co.uk\" is a public suffix, not a domain anyone can configure"}}

curl -s -X POST $A/v1/checks -H 'content-type: application/json' -d '{}'
# {"error":{"message":"domain: Invalid input: expected string, received undefined"}}
```

Messages name the field and the value that would fix it. They are written to be
actionable by the agent reading them, not only by a person.

## Clean up

```sh
curl -s -X DELETE $A/v1/domains/$ID -H "authorization: Bearer $KEY" | j
```

---

Full reference at [docs.propgate.dev/api](https://docs.propgate.dev/api). Every
diagnosis code is documented at
[docs.propgate.dev/taxonomy](https://docs.propgate.dev/taxonomy), and the
[RFC conformance ledger](https://docs.propgate.dev/conformance) says which parts
of which specifications are actually asserted by a test.
