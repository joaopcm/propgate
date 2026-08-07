---
"@propgate/dns": minor
"@propgate/cli": minor
---

`spf` and `mx` can be asked at a label, and may repeat.

Every sending platform publishes SPF twice: at the apex, which governs mail
whose From header carries the domain, and at a bounce host like `send`, which
governs the envelope sender receivers actually check for alignment. It asserts
opposite things about MX at those two names — a send-only apex must have no
deliverable MX, and the bounce host beneath it must have one.

Neither was expressible. A requirement was evaluated at the registered domain
and nowhere else, so covering a Resend, SES or Postmark domain meant registering
two domains, writing two profiles, and reassembling one answer out of two states
and two webhook streams. `label` already meant "the part of the name before the
domain" for `ownership` and `cname`; it now means the same on `spf` and `mx`,
and both kinds join the repeatable list.

```
{ "key": "apex",   "check": "mx",  "expectsMail": false }
{ "key": "bounce", "check": "spf", "label": "send", "include": "amazonses.com" }
{ "key": "mail",   "check": "mx",  "label": "send", "expectsMail": true }
```

No new diagnosis codes: a finding already carries the name it is about, so a
labelled failure reports `send.customer.com` and the requirement key says which
of your requirements it belongs to.

**Breaking for `@propgate/dns`.** `DomainProfile.spfInclude`, `spfIp` and
`expectsMail` are replaced by `spf: SpfLabel[]` and `mx: MxLabel[]`. The
`sendingOnly`, `fullMail` and `webOnly` helpers are unchanged, as is the
`POST /v1/checks` request body — that endpoint diagnoses one name and stays flat.

Also fixes `propgate profiles create --require`, which parsed `label`, `target`
and `token`, validated them as known fields, and then dropped them before
sending — so every `cname` and `ownership` requirement written from the CLI
since those checks shipped arrived without its values.
