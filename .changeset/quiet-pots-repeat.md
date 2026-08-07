---
"@propgate/sdk": minor
---

Add `@propgate/sdk`: the propgate API from Node, with a method for every route
except signup.

`new Propgate(apiKey)` and then `propgate.domains.check(id)`. Every call returns
`{ data, error, meta }` and none of them throw, so the failure branch is
type-checked rather than an `unknown` from a `catch`. `listAll` walks a cursor to
the end; retries cover connection failures, timeouts and rate limits, and
deliberately never repeat a `POST` that may already have been applied.

`apps/api/src/sdk-coverage.spec.ts` reads the API's own router, so a route added
without a method to reach it fails there rather than in an integration.
