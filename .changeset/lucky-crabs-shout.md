---
"@propgate/dns": minor
---

Three codes that were published but that nothing could ever produce now fire:
`NODATA_NOT_NXDOMAIN`, `NEGATIVE_CACHE_LIKELY` and `TRUNCATED_FELL_BACK_TO_TCP`.
A negative answer now says what *kind* of nothing came back — whether the name
exists, and how long the absence will be remembered.

`NOT_YET_EMITTED` and its guard make the general case impossible to repeat: a
code must be reported by an evaluator or listed with the reason it is not, and
the reason must say what it would take.
