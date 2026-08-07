---
"@propgate/cli": minor
---

**`domains add --expect` supplies the values a profile requires per domain.**

A profile can now name fields it expects each domain to supply rather than
fixing them for every domain at once — `requiredPerDomain: ["expectedPublicKey"]`
on a DKIM requirement says *there must be a key at this selector*, and leaves
*which key* to the domain. Registering against such a profile without those
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
