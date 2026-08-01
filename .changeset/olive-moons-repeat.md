---
"@propgate/dns": patch
---

Fix a false positive: a DKIM key split across TXT character-strings and rejoined
with whitespace was reported as malformed. RFC 6376 §2.10 permits folding
whitespace at arbitrary places inside a base64 value, and every 2048-bit key is
split by necessity — so this told a customer their working key was broken.

`TXT_VALUE_SPLIT_MANGLED` now fires on a rejoin that is actually a rejoin: the
`v=DKIM1` prefix repeated on every chunk.
