---
"@propgate/cli": minor
"@propgate/dns": minor
---

`propgate check <domain>` — the same engine as the public checker and the API,
run from a terminal against whichever resolver you are actually using.

Exit codes carry the distinction the resolver works to preserve: `0` nothing to
fix, `1` something is wrong, `2` a check could not be completed. Collapsing the
last two would fail a deploy over a resolver blip, which is exactly what the
four-valued verdict exists to prevent.

`DomainProfile.expectsMail` is now optional, with three states rather than two.
Undeliverable mail is only a fault if someone said the domain should receive it,
and defaulting to `true` reported every correctly configured sending-only domain
as broken. A caller who does not say is no longer assumed to have said anything.
