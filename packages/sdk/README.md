# @propgate/sdk

The propgate API from Node. Register the domains your customers set up, verify
them against real DNS, and find out *why* one is failing — programmatically,
with types.

MIT licensed. Part of [propgate](https://github.com/joaopcm/propgate).

```sh
npm install @propgate/sdk
```

```ts
import { Propgate } from "@propgate/sdk";

const propgate = new Propgate("pg_live_...");

const { data, error } = await propgate.domains.check("dom_01J...");

if (error) {
  console.error(error.code, error.message);
} else {
  console.log(data.state, `${data.requirementsMet}/${data.requirementsTotal}`);
}
```

## Nothing throws

Every method returns `{ data, error, meta }` — the same envelope the API puts on
the wire.

```ts
const { data, error } = await propgate.domains.get("dom_01J...");

if (error !== null) {
  // `error.code` is a union: "not_found", "rate_limited", "unauthorized"…
  // `error.statusCode` is the HTTP status, or 0 if there never was a response.
  return;
}

data.state; // narrowed to a domain here, without a cast
```

A `catch` binds `unknown` and the compiler never mentions the case you forgot.
Returning the failure instead means the branch is type-checked. `PropgateError`
is still an `Error` subclass, so `throw result.error` keeps a stack if that is
the style you prefer.

`meta` carries what a body cannot: `nextCursor` on the paged lists, `created` on
an idempotent create, `resolver` on a check, `previousSecretExpiresAt` on a
rotation.

## Configuration

```ts
const propgate = new Propgate(process.env.PROPGATE_API_KEY, {
  baseUrl: "http://localhost:3000", // defaults to https://api.propgate.dev
  maxRetries: 2,
  timeoutMs: 30_000,
  fetch: myInstrumentedFetch,
});
```

The key falls back to `PROPGATE_API_KEY`. A missing key is not an error at
construction, because `checks.run` and `health` do not need one — but every other
call fails immediately with `code: "missing_api_key"` rather than spending a
round trip to be told 401.

Both `timeoutMs` and an `AbortSignal` are also per call:

```ts
await propgate.domains.listAll({}, { signal: controller.signal });
```

### What gets retried

Connection failures, timeouts, 429s and 5xx — but **never a `POST` that may
already have been applied**, because `POST /v1/api-keys` mints a key every time
it is called. The one exception is a 429, where the server refused before doing
anything, so repeating the request cannot repeat an effect.

A `Retry-After` longer than five seconds is not waited out. It comes back as
`error.retryAfterSeconds` instead, so a 47-second rate limit is your scheduler's
decision rather than a stall inside an `await` you cannot see.

## Every call

### Checks — the public checker, no key required

```ts
await propgate.checks.run({ domain: "example.com", checks: ["spf", "dkim"] });
```

Stateless: nothing is stored and nothing is scheduled. `data.findings` carries
diagnosis codes with the taxonomy folded in, so you can render a summary and link
to the docs without shipping a copy of the registry.

### Profiles — what you expect of a domain's records

```ts
await propgate.profiles.create({
  key: "sending",
  requirements: [
    { key: "dkim", check: "dkim", selector: "pg1", requiredPerDomain: ["expectedPublicKey"] },
    { key: "dmarc", check: "dmarc" },
    { key: "bounce-spf", check: "spf", label: "send", include: "spf.acme.com" },
  ],
});

await propgate.profiles.get("sending");
```

Writing a key that exists creates a new *version*. Domains keep being judged
against the version they were registered with until something re-points them.

### Domains — the lifecycle

```ts
await propgate.domains.create({
  name: "customer.com",
  profile: "sending",
  externalId: "cust_42",
  expectations: { dkim: { expectedPublicKey: "MIIBIj..." } },
});

await propgate.domains.list({ state: "failed" });
await propgate.domains.listAll({ state: "failed" }); // follows the cursor
await propgate.domains.get("dom_01J...");
await propgate.domains.update("dom_01J...", { expectations: { dkim: { expectedPublicKey: rotated } } });
await propgate.domains.check("dom_01J...");
await propgate.domains.timeline("dom_01J...");
await propgate.domains.remove("dom_01J...");
```

`create` and `check` are separate calls on purpose: importing ten thousand
domains must not fire ten thousand DNS runs. `create` is idempotent on
`externalId`, and `meta.created` tells a retry from a second customer.

Rotating a key is `update`, never a second `create` — the idempotent path
answers 200 having written nothing, and a success response for a no-op while the
sweeper still compares the old key is the worst available failure.

`timeline` is what *changed*, not every check that ran. Two identical checks add
nothing to it.

### Webhooks — where state changes are sent

```ts
const { data } = await propgate.webhooks.create({
  url: "https://acme.com/hooks/propgate",
  events: ["domain.verified", "domain.failed"],
});

data.secret; // readable exactly once

await propgate.webhooks.list();
await propgate.webhooks.get(id);
await propgate.webhooks.update(id, { disabled: true });
await propgate.webhooks.rotateSecret(id, { windowHours: 24 });
await propgate.webhooks.listDeliveries(id, { status: "failed" });
await propgate.webhooks.listAllDeliveries(id);
await propgate.webhooks.remove(id);
```

Verifying a signature on the receiving end is not this package's job — a request
handler should not have to construct an API client to check a signature. The
payload type is exported here as `WebhookPayload` for the handler's benefit.

### API keys and members

```ts
await propgate.apiKeys.create({ name: "production" }); // data.key, once
await propgate.apiKeys.list();
await propgate.apiKeys.revoke(id);
await propgate.members.list();
```

Revoking the key you are authenticating with is fine — it is the rotation move.
Revoking your *last active* key is refused: there is no un-revoke.

### Health

```ts
await propgate.health();
```

## Opening an account

There is no signup call here, deliberately. It is a mailbox flow — a six-digit
code goes to an address and comes back to mint the first key — and by the time
you are holding this package you already have a key. Use
[`@propgate/cli`](https://www.npmjs.com/package/@propgate/cli):

```sh
npx @propgate/cli signup --email you@example.com
npx @propgate/cli confirm --email you@example.com --code 123456
```

## Related

- [`@propgate/dns`](https://www.npmjs.com/package/@propgate/dns) — the resolver
  and evaluators behind every verdict. Zero runtime dependencies.
- [`@propgate/cli`](https://www.npmjs.com/package/@propgate/cli) — the same API
  from a terminal, plus signup.
