# These private keys are committed on purpose

**They are worthless. They protect nothing. Do not treat them as secrets.**

They sign a fake DNS root and zones under `.test`, which [RFC 6761][rfc6761]
reserves for exactly this. None of these names can ever exist on the public
internet, so nothing signed here can ever be trusted by anything real.

## Why commit them

The fixture zones are signed offline and their signed output is committed, so
that:

- the serving containers contain no signing tooling and therefore cannot
  accidentally re-sign — and thereby silently *repair* — a zone whose brokenness
  is the entire point;
- `bogus-zone.test` stays reliably bogus rather than being fixed by a helpful
  online signer;
- the DS chain from the fake root down through `test.` to each child is stable,
  so the validating resolver's trust anchor never moves.

Signed output is worthless without the keys that produced it. Generating fresh
keys on each checkout would change every signature, change the trust anchor, and
make the fixtures irreproducible — which would defeat all three points above.

## Regenerating

```sh
pnpm dns:sign
```

Idempotent: existing keys are reused, so re-signing does not churn the chain.
Delete a zone's key pair to force a rollover.

`dnssec-signzone`'s record *ordering* is not stable between runs, so re-signing
always produces a diff even though the signatures themselves are deterministic
for the RSASHA256 zones. `wildcard-signed.test` uses ECDSAP256SHA256, whose
signatures embed a random nonce and genuinely differ every time.

## Layout

| Zone | Algorithm | Why |
|---|---|---|
| `.` | RSASHA256 (8) | The fake root. Its KSK is the resolver's only trust anchor. |
| `test.` | RSASHA256 (8) | Signed parent, so DS presence and absence are both meaningful. |
| `secure.test` | RSASHA256 (8) | The control — must validate cleanly. |
| `bogus-zone.test` | RSASHA256 (8) | Both DNSKEY RRSIGs corrupted after signing. |
| `wildcard-signed.test` | ECDSAP256SHA256 (13) | Covers the dominant real-world algorithm and the RRSIG `Labels` wildcard signal. |

[rfc6761]: https://www.rfc-editor.org/rfc/rfc6761#section-6.2
