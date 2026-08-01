---
"@propgate/dns": minor
---

DKIM outcomes now carry per-selector detail, and a selector can name the key it
should be publishing.

`CheckOutcome.selectors` appears on the `dkim` outcome and lists each selector's
own findings, lookups and verdict. The merged verdict is unchanged — "is DKIM
set up" is still one question with one answer — but a platform that issued three
keys can now tell which of them is missing, which a merged answer cannot express.

`DomainProfile.dkimSelectors` accepts `{ selector, expectedPublicKey }` as well
as a bare string. The bare string asks whether a valid key is published; the
object asks whether *your* key is, which is what catches a domain that pasted
someone else's record. Passing strings keeps working exactly as before.
