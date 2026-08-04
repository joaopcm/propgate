# propgate

Domain verification and DNS lifecycle infrastructure. Read `docs/DESIGN.md`
first — it is the scope contract, and it says what is deliberately *not* being
built yet. `README.md` is the product-facing page; `QUICKSTART.md` is the worked
example.

## Invariants

These are load-bearing. Each one exists because getting it wrong produces a
product that is worse than not shipping.

### 1. Never mock DNS

Query the real fixture tier (`pnpm dns:up`). Mocking responses hides exactly the
bugs the diagnosis taxonomy exists to catch — mangled TXT splits, wildcard
synthesis, truncation, DNSSEC state. A mocked resolver will agree with whatever
you believed when you wrote the mock.

The one sanctioned exception is liveness probing in
`packages/dns-fixtures/src/ready.ts`, which uses `node:dns`. Do not follow that
lead anywhere in the resolver or the evaluators.

**The same rule covers Redis.** `*.queue.spec.ts` runs against a real container
(`pnpm redis:up`), gated on `PROPGATE_REDIS`. Everything worth knowing about a
queue — that BullMQ's version check passes, that a key prefix really isolates,
that retention lands on the job — is a property of the server, not of our code.

### 2. Regression detection needs hysteresis

A `domain.failed` webhook fired because one resolver blipped makes our customers
page *their* customers for nothing. Consensus across vantage points **and**
consecutive-failure thresholds, with `degraded` as a state distinct from
`failed`. This is the highest-stakes correctness property in the product.

### 3. Store changes, never observations

Update `last_checked_at` / `last_result` in place. Append to `record_changes`
only when a value actually changed. Logging every check result is 360k rows/day
at 10k domains and turns a $20 infra bill into $400.

### 4. No per-invocation billing in the sweep path

The sweeper is a continuous loop — the worst possible fit for serverless pricing.
One long-running process. No Inngest, no Upstash, nothing serverless between the
scheduler and the resolver. Request-driven surfaces (the dashboard) are fine.

**This bans per-invocation billing, not queues.** BullMQ against a Redis container
in our own compose stack is exactly the long-running process this asks for, and
`packages/jobs` is where it lives. What stays banned is paying per tick: the Redis
is one we run, and **never Upstash**, whose per-command pricing against a sweeper
waking every 60 seconds is the failure mode this invariant exists to prevent.

Redis is the conveyor belt and Postgres is the truth. Nothing may live only in
Redis: `domains.next_check_at` decides what is due and `webhook_deliveries` records
what is owed, so a flushed Redis costs in-flight attempts and never obligations. A
job payload carries identifiers and nothing else, for the same reason.

### 5. Everything is port-aware

Addresses are `{ address, port, transport }` and `port` is never assumed to be
53. Root hints are injectable. The fixture tier serves real port 53 on distinct
loopback addresses precisely so delegation-following needs no shim; hardcoding
53 breaks that, and hardcoding a high port breaks production.

### 6. Semantics, not string matching

Evaluate SPF the way an MTA would — recursive `include:` expansion, the 10-lookup
and 2-void-lookup limits. Parse DKIM keys. Climb the CAA tree per RFC 8659. A
regex over a TXT record is not a verifier.

### 7. Diagnosis codes are a public contract

Consumers switch on them. Adding one requires a fixture or a written reason it
cannot exist locally (`NOT_LOCALLY_REPRODUCIBLE`), enforced by
`packages/dns/src/diagnosis/coverage.spec.ts`. Changing or removing a code is a
breaking change.

### 8. Zero runtime dependencies in `@propgate/dns`

It is the credibility artifact and the top of funnel. Node built-ins only. That
is why the DNS wire codec is hand-rolled rather than pulling in `dns-packet`.

## Layout

```
apps/api    Hono resolver service. Long-running by design.
apps/web    Next.js — marketing plus the public checker.
apps/docs   Next.js + MDX — the taxonomy and the API reference, both rendered
            from the code they describe.
packages/dns           @propgate/dns — resolver, evaluators, taxonomy. MIT.
packages/dns-fixtures  Zone files, signing pipeline, test harness. Private.
packages/db            Drizzle schema, migrations, and the queries. Private.
packages/jobs          BullMQ queue names, payload types, connection. Private.
packages/emails        Resend client and the confirmation message. Private.
packages/webhooks      Webhook signing and payload shapes. Private.
packages/cli           @propgate/cli. MIT.
```

`apps/api` also builds `dist/worker.js` — the background process, run as a second
container from the same image with a different command, the way `migrate` already
is. Queue admin (Workbench) is mounted there and never on the API: it is a pre-1.0
dependency, and customer traffic should not share a process with it.

`packages/db` and the authenticated routes in `apps/api` arrived with Phase 2
milestone 1; `packages/jobs` and `packages/webhooks` with milestone 2;
`packages/emails` with self-serve accounts. `sdk` and `ui` have not. Do not add them early — the phasing exists so a control plane
that may never ship is not pre-built, and that reasoning still holds for
everything on that list.

## Commands

```sh
pnpm install
pnpm dns:up                      # bring up the DNS fixture tier
pnpm redis:up                    # bring up Redis, for the queue specs
pnpm lint                        # tsc --noEmit across the workspace
pnpm test                        # static + unit specs, no containers needed
PROPGATE_FIXTURES=1 pnpm test    # adds the fixture-backed projects
PROPGATE_REDIS=1 pnpm test       # adds the queue specs
pnpm check                       # ultracite (Biome) check
pnpm fix                         # ultracite autofix
pnpm dns:sign                    # re-sign the DNSSEC fixtures (rarely)
```

## Code standards

Biome via Ultracite. `pnpm fix` before committing. Beyond what Biome enforces:

- Explicit types on exported function signatures; `unknown` over `any`
- `const` by default; `for...of` over `.forEach`
- Early returns over nested conditionals
- Barrel files only as package entry points, with the `biome-ignore` comment
- No `console.log` in committed code
- Comments explain *why*, and are worth writing where the reasoning is
  non-obvious — the DNS pathologies here are full of details that look like
  mistakes until you know the RFC

## Testing

Read `TESTING.md` before writing or changing tests. Highlights that differ from
the obvious defaults:

- `*.spec.ts` colocated with the code
- `*.fixture.spec.ts` for specs needing the live DNS tier
- `*.serial.spec.ts` for cache-sensitive or zone-mutating specs
- `fileParallelism` stays **on** for DNS specs — the fixtures are read-only, so
  do not copy the `fileParallelism: false` pattern that a shared Postgres needs
- Every bug fix ships a regression test that fails before the fix
