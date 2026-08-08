---
"@propgate/sdk": minor
---

Export `PROPGATE_ERROR_CODES`, the runtime list `PropgateErrorCode` is derived
from — the same shape as `CHECK_KINDS` and `WEBHOOK_EVENTS` elsewhere.

A union alone exists only at compile time, so nothing could check that the
documented table of codes covers what a consumer can actually receive. The docs
now assert exactly that against this array.
