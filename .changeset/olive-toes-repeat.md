---
"@propgate/sdk": minor
---

Export `PROPGATE_ERROR_CODES`, the runtime list `PropgateErrorCode` is derived
from — the same shape as `CHECK_KINDS` and `WEBHOOK_EVENTS` elsewhere.

A union alone exists only at compile time, so nothing could check that the
documented table of codes covers what a consumer can actually receive. The docs
now assert exactly that against this array.

Also exports `MAX_RETRY_WAIT_MS`: it decides whether a rate limit is ridden out
inside a call or handed back as `retryAfterSeconds`, so it is a number a caller
schedules around, and the documented worst case is now computed from it rather
than typed out.
