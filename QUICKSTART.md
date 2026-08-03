# Quickstart

Every command here was run against the live API. The outputs are real, including
the unflattering ones.

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

## With a key

Registration and verification are separate calls. Registration is a write;
verification is an action with latency. Importing ten thousand domains should
not fire ten thousand DNS runs as a side effect of a bulk insert.

```sh
export KEY=pg_live_...
```

### A profile: what you expect of a domain

```sh
curl -s -X POST $A/v1/profiles -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{
    "key": "sending",
    "requirements": [
      { "key": "ns",    "check": "delegation" },
      { "key": "spf",   "check": "spf", "include": "_spf.google.com" },
      { "key": "dkim",  "check": "dkim", "selector": "google" },
      { "key": "dmarc", "check": "dmarc" },
      { "key": "mail",  "check": "mx", "expectsMail": true }
    ]
  }' | j
```

Editing a profile writes a **new version**; it never changes the old one, and
domains stay pinned to the version they were registered against. Otherwise one
edit silently reclassifies every domain at once.

A definition is refused at write time if any requirement could never be
answered — a duplicate key, a DKIM requirement with no selector, a CAA
requirement with no issuer. Accepting those would be a promise this API could
not keep.

### Register, then verify

```sh
curl -s -X POST $A/v1/domains -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{"name":"yourdomain.dev","profile":"sending","externalId":"cust_1"}' | j

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
