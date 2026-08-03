# Continuous Monitoring and Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Each phase is one PR. Phase-level task breakdowns are written when that phase starts, not up front — the later phases' shape depends on what the earlier ones measure.

**Goal:** Make propgate a monitor rather than an on-demand checker: a sweeper that
decides when to look, consensus across vantage points, a hysteresis state machine,
and outbound webhooks.

**Architecture:** Postgres is the truth and Redis is the conveyor belt. Scheduling
lives in `domains.next_check_at` and obligations live in `webhook_deliveries`;
BullMQ only distributes and retries work that is always re-derivable from
Postgres. A worker container runs from the same image as the API with a different
command, exactly as `migrate` already does.

**Tech Stack:** `bullmq@6.0.6`, Redis 8, `@getworkbench/hono@0.9.1` (MIT, pinned
exactly — pre-1.0), Drizzle, Hono, Vitest.

## Global Constraints

- **Never mock DNS** (invariant 1), and now **never mock Redis** — a real
  container, gated by env, never a stub.
- **Zero runtime dependencies in `@propgate/dns`** (invariant 8). `bullmq` goes in
  `packages/jobs` and `apps/api`. Never in `packages/dns`.
- **Store changes, never observations** (invariant 3). Update in place; append only
  on a real change.
- **No per-invocation billing in the sweep path** (invariant 4). Self-hosted Redis;
  **never Upstash**.
- **Everything is port-aware** (invariant 5). `RESOLVER_ADDRESSES` carries ports.
- **Diagnosis codes are a public contract** (invariant 7). Phase 3 removes a
  `NOT_YET_EMITTED` entry and must ship the fixture that earns it.
- **Every number needs a receipt.** No threshold ships without either a
  measurement or a comment naming it as unmeasured and what would measure it.
- Any new test-gate flag goes in `turbo.json`'s `test.env` in the same commit.
- `pnpm fix` before committing. Read command output in full — piping through
  `tail` has hidden Biome failures in this repo twice.
- No artifact names the design partner. "A design partner" throughout.

---

## Context

Phase 2 milestone 1 shipped the control plane: `packages/db`, authenticated
routes, versioned profiles, domain registration and on-demand verification. It is
deployed and live at `api.propgate.dev`. What it cannot do is notice anything on
its own — every check is something a customer asked for synchronously.

`domains.next_check_at` and `domains_state_next_check_at_idx` already exist and
**nothing writes them**. They were added in milestone 1 specifically so this
milestone adds a transition rather than migrating an enum under live rows. Same
for the `domain_state` enum: all five values exist, and `degraded` has never been
reachable because it needs hysteresis that has not been built.

`docs/DESIGN.md`'s "Planned stack" table already reads **"BullMQ + ioredis,
Workbench for queue admin"**, and its principle 1 (adaptive scheduling) and
principle 4 (store changes, never observations) already specify the scheduling
policy this plan implements. This is cashing a row we wrote in Phase 0, not a new
direction.

### Invariant 4 is about billing, not about queues

> "No Inngest, no Upstash, nothing serverless between the scheduler and the
> resolver. One long-running process."

BullMQ against a Redis container in our own compose stack is a long-running
worker talking to a process on the same box. It is precisely what the invariant
asks for. What the invariant forbids is **per-invocation pricing on a continuous
loop** — so the Redis is one we run, and **never Upstash**, whose per-command
billing against a sweeper ticking every 60 seconds is the exact failure mode
being banned. This gets written into `.claude/CLAUDE.md` as part of the invariant
so the next reader does not have to re-derive it.

### The load-bearing decision: Postgres is the truth, Redis is the conveyor belt

Redis can be wiped — evicted, restarted without a volume, or corrupted — and the
system has to survive it without losing a domain or a webhook.

So **no state lives only in Redis.** `domains.next_check_at` decides what is due;
a `webhook_deliveries` row is the ledger of what is owed. BullMQ jobs are how work
gets distributed and retried, and they are always re-derivable from Postgres. If
Redis loses everything, the next tick re-enqueues from `next_check_at` and the
reconciler re-enqueues pending deliveries. Nothing needs to be replayed by hand.

That is what makes it safe to run BullMQ at all, and every phase below is
constrained by it.

```
                     ┌──────────────── Postgres (the truth) ────────────────┐
                     │ domains.next_check_at  webhook_deliveries  state_…   │
                     └──────▲────────────────────▲──────────────────▲───────┘
                            │ claim/reschedule   │ ledger           │ evidence
 ┌── api container ──┐  ┌───┴──── worker container (same image) ─────┴─────┐
 │ HTTP  /v1/*       │  │ tick (every 60s, upsertJobScheduler)             │
 │ on-demand checks  │  │   └─▶ check-domain ─┬─ resolver pool (3 vantages)│
 │                   │  │                     ├─ consensus                 │
 │ (no queue admin)  │  │                     ├─ hysteresis ─▶ transition  │
 │                   │  │                     └─ enqueue webhook           │
 │                   │  │ deliver-webhook (attempts + backoff → dead-letter)│
 │                   │  │ reconcile (every 5m, re-derives lost work)       │
 │                   │  │ Workbench :3002 → 127.0.0.1 / tailnet only       │
 └───────────────────┘  └──────────────────┬──────────────────────────────┘
                                           │
                                  Redis (conveyor belt, disposable)
```

### Decisions

| Decision | Choice |
|---|---|
| Worker topology | **Separate compose service, same image.** `node dist/worker.js`, like the existing `migrate` container. A sweep cannot starve the HTTP event loop |
| Workbench exposure | **On the worker, own port, bound to `${WORKBENCH_BIND_ADDRESS:-127.0.0.1}`.** Same pattern Postgres already uses, so DEPLOYING.md's Tailscale section covers it verbatim. A 0.x dashboard never sits in the customer request path |
| Hysteresis receipts | Conservative numbers, **documented as unmeasured**, tunable by env so a false alarm is a restart and not a deploy |
| Vantage points | Our Unbound plus **`1.1.1.1` and `9.9.9.9`**. Both validate DNSSEC, which our attribution depends on |
| Sweep strategy | **Adaptive scheduling only.** The SOA-serial fast path waits for measured load |
| Webhook events | All four, including `degraded` — with `degraded` firing **once per episode**, never on re-entry |
| Webhook wire format | Svix-compatible, per DESIGN.md's scope table |
| Redis `maxmemory` | **Unset.** A cap we have not measured is a tripwire in the wrong place; `noeviction` is what actually matters |
| Consensus on `POST /v1/domains/:id/verify` | **Yes — the same path as the sweeper.** See below |
| Webhook secret rotation | **Two active secrets** during a window |

#### Why consensus runs on the on-demand route too

The vantage points are queried in **parallel**, so the wall clock is the slowest
resolver rather than the sum — roughly 1.2–1.5x, not 3x. An earlier draft of this
plan claimed 3x and made the trade-off look worse than it is.

At that cost, one code path is clearly right. A single-resolver verify that
returns `verified` can be contradicted by the sweeper sixty seconds later, and a
product with two opinions about the same domain is worse than a slightly slower
one.

Divergence during propagation resolving to `indeterminate` is **correct**, not a
regression: "published, but it has not reached everyone yet" is more useful on a
first verify than a green that flips. `nextState` already holds the domain at
`pending` for `indeterminate`, so it keeps polling every 30 seconds and converges
on its own.

The unauthenticated public checker (`/v1/checks`) stays **single-resolver**. It
tracks no state, so there is nothing for it to contradict, and tripling anonymous
egress DNS on a free surface buys nothing. Showing divergence there is a
reasonable follow-up, not this milestone.

---

## Phases

Six phases, each its own PR, each shippable on its own. Phases 1–2 are the
substance; 3–5 are additive; 6 is the receipts.

### Phase 1 — Redis, BullMQ, the worker process, and Workbench

Infrastructure only. No product behaviour, no schema changes. Ends with a job
round-tripping through a real Redis in CI and Workbench rendering the queue.

**New package `packages/jobs`** (private) — the shared vocabulary between the API
(producer) and the worker (consumer):

| File | Responsibility |
|---|---|
| `src/connection.ts` | One `connectionFor(url)` returning BullMQ connection **options**, not an `ioredis` instance |
| `src/queues.ts` | `QUEUE_NAMES` and typed `Queue` factories |
| `src/payloads.ts` | The job payload interfaces. Producer and consumer share these or they drift |
| `src/index.ts` | Barrel, with the `biome-ignore` comment per the code standards |

Pass BullMQ plain connection **options** rather than our own `ioredis` client.
BullMQ then sets `maxRetriesPerRequest: null` itself, which a `Worker` requires
and which is the classic silent-hang landmine when you hand it your own client.
Adding `ioredis` as a direct dependency only becomes necessary if we ever need a
shared client, and we do not.

**Worker entrypoint** at `apps/api/src/worker.ts`, added to `entry` in
`apps/api/tsup.config.ts` alongside `index.ts`/`migrate.ts`/`keys.ts`. Same image,
different command — exactly the pattern `migrate` already uses. It mounts
`@getworkbench/hono` on its own Hono instance on `WORKBENCH_PORT` (3002), behind
basic auth, and registers no queues yet.

**`apps/api/Dockerfile` must gain two lines.** It enumerates every workspace
manifest by hand (`COPY packages/db/package.json packages/db/`) and then copies
sources. A missing `packages/jobs` manifest fails `pnpm install` with a confusing
resolution error — this exact thing already cost a debugging session when
`packages/db` landed.

**Env** (`apps/api/src/env.ts`): `REDIS_URL` (required — same reasoning as
`DATABASE_URL`: discovering it on the first tick means discovering it in
production), `WORKBENCH_PORT` (default 3002), `WORKBENCH_USER` / `WORKBENCH_PASS`
(optional; Workbench is not mounted when unset, so a box can run without it).

**Compose.** `redis:8-alpine` in both `docker-compose.yml` (dev) and
`docker-compose.prod.yml`, plus the `worker` service in prod. Two settings are
non-negotiable and both are landmines:

```yaml
redis:
  image: redis:8-alpine
  # noeviction because BullMQ stores job state in Redis keys. Under any other
  # policy Redis silently drops jobs when memory fills, and the symptom is a
  # domain that stopped being checked with nothing in any log.
  #
  # No maxmemory: a cap we have not measured is a tripwire in the wrong place.
  command: ["redis-server", "--maxmemory-policy", "noeviction", "--appendonly", "yes"]
  volumes: [redis-data:/data]
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
```

AOF is on even though Postgres is the truth: it costs almost nothing at this
throughput, and it means a restart does not need the reconciler to earn its keep.

**Testing — never mock Redis.** Same rule shape as never mocking DNS, and buckt's
"never mock Postgres or Redis". New spec suffix `*.queue.spec.ts`, project
`jobs-redis`, gated on `PROPGATE_REDIS=1`.

Unlike the Postgres specs, this project keeps **`fileParallelism` on**. Each spec
gets a unique BullMQ `prefix`, which namespaces every key it touches — the same
trick `uniqueLabel()` plays for the DNS cache. Do not copy `fileParallelism:
false` from `db-postgres`; that setting belongs to the shared-mutable-state
problem, and a per-spec prefix removes the problem instead of serialising around
it.

**`PROPGATE_REDIS` must be added to `turbo.json`'s `test.env`.** Turbo strips
undeclared variables, and this is exactly how `PROPGATE_FIXTURES` went green
across two PRs while running nothing. `.github/workflows/test.yml` brings Redis up
with `docker compose up -d --wait redis` and runs `vitest --project jobs-redis` by
name as a tripwire, since vitest exits non-zero when a named project matches no
files.

**Files:** `packages/jobs/*` (new), `apps/api/src/worker.ts`,
`apps/api/tsup.config.ts`, `apps/api/src/env.ts`, `apps/api/Dockerfile`,
`docker-compose.yml`, `docker-compose.prod.yml`, `vitest.config.ts`, `turbo.json`,
`.github/workflows/test.yml`, `.claude/CLAUDE.md` (invariant 4 clarification, and
never mocking Redis), `TESTING.md` (the new suffix and why parallelism stays on).

**Verify:** `pnpm redis:up` then a `*.queue.spec.ts` enqueues and drains a job
against real Redis; `docker compose -f docker-compose.prod.yml up` brings up
api + worker + redis with the worker healthy; `curl -u user:pass localhost:3002`
renders Workbench; `pnpm lint && pnpm test` green.

---

### Phase 2 — The sweeper

The first phase with product behaviour: domains get checked because time passed.

**`packages/db/src/queries/sweep.ts`**

- `claimDueDomains(db, { limit })` — `where next_check_at <= now()` ordered by
  `next_check_at`, `FOR UPDATE SKIP LOCKED`, setting `state = 'verifying'` and
  pushing `next_check_at` forward by a lease interval in the same statement. The
  lease is what makes a crashed worker self-healing: the row becomes claimable
  again without anyone unsticking it.
- `rescheduleDomain(db, { id, nextCheckAt, result, state })` — updates
  `last_checked_at` / `last_result` / `state` / `next_check_at` **in place**.
  Invariant 3: no row per check.

**`packages/jobs/src/schedule.ts`** — `nextCheckAt(state, observedTtlSeconds,
now)`, implementing the policy `docs/DESIGN.md` already committed to rather than
inventing one: `pending` every 30s for 15 minutes then backing off to 5 minutes;
`verified` daily; `degraded` every 5 minutes; `failed` hourly; **floored at the
observed TTL** so we never poll faster than the data can change. Pure function,
injectable clock, unit-tested — no sleeps, per TESTING.md.

**`apps/api/src/sweep/tick.ts`** — registered with
`queue.upsertJobScheduler("sweep-tick", { every: SWEEP_TICK_MS }, …)`. Idempotent
by scheduler id, so a restart does not accumulate duplicate schedulers. It claims
a batch and enqueues one `check-domain` job per row. It does no DNS itself, so a
slow resolver cannot delay the next tick.

**`apps/api/src/sweep/check-domain.ts`** — loads the pinned profile version, then
reuses `compileProfile` and `attributeResults` from
`apps/api/src/profiles/compile.ts`, `runChecks` from `@propgate/dns`, and
`nextState` from `apps/api/src/domains/state.ts`, all unchanged. The on-demand
route and the sweeper must produce byte-identical results or the product has two
opinions; sharing these functions is what guarantees that.

**`apps/api/src/sweep/reconcile.ts`** — a second scheduler, every 5 minutes:
counts rows due more than one tick ago and re-enqueues them. This is the Redis
amnesia backstop, and it is the reason nothing in this design is afraid of a
flushed Redis.

**Env:** `SWEEP_TICK_SECONDS` (60), `SWEEP_BATCH_SIZE` (100),
`CHECK_CONCURRENCY` (4), `SWEEP_LEASE_SECONDS` (300). Every one carries a comment
naming it as **unmeasured** and what would earn the receipt — for
`CHECK_CONCURRENCY` that is "the point at which our Unbound's response latency
degrades under parallel checks", measurable on the box in Phase 6.

**Verify:** an integration spec registers a domain with `next_check_at` in the
past, runs one tick against the live fixture tier plus real Redis, and asserts
`last_result` and a forward-moved `next_check_at`; a second spec asserts two
concurrent ticks claim disjoint sets (`SKIP LOCKED`); a third flushes Redis
mid-flight and asserts the reconciler recovers the domain.

---

### Phase 3 — Vantage points and consensus

Independent of the queue, and it closes one of the three remaining unemitted
diagnosis codes.

Consensus belongs in **`packages/dns`**, not in the API: it is the credibility
artifact and `ANSWER_DIVERGES_BY_VANTAGE_POINT` is in its taxonomy, so the code
must be emitted from the package that owns the registry. Still zero runtime
dependencies — this is `Promise.all` over a list of `{ address, port }`, which the
resolver already accepts per invariant 5.

- `packages/dns/src/check/consensus.ts` — `runChecksAcrossVantagePoints({ domain,
  profile, resolvers })`. Majority wins per requirement. On disagreement the
  verdict is **`indeterminate`, never `fail`**, and it reports
  `ANSWER_DIVERGES_BY_VANTAGE_POINT`. Disagreement means we cannot tell, and
  `indeterminate` is already the verdict for that — carrying it through here is
  the same four-valued discipline as everywhere else.
- Fixture: `dns-divergent` at `127.0.0.8` **already exists** and was built in
  Phase 0 for exactly this. The fixture spec queries the honest resolver and the
  divergent one and asserts the code, which removes the code's `NOT_YET_EMITTED`
  entry in `packages/dns/src/diagnosis/codes.ts` and satisfies
  `coverage.spec.ts`.
- Env: `RESOLVER_ADDRESSES` as a comma-separated `address:port` list, superseding
  `RESOLVER_ADDRESS`/`RESOLVER_PORT` while keeping them as the single-resolver
  fallback so nothing already deployed breaks. Production is our Unbound plus
  `1.1.1.1` and `9.9.9.9`.
- Both the sweeper and `POST /v1/domains/:id/verify` route through this. The
  public `/v1/checks` does not — see "Why consensus runs on the on-demand route
  too" above.

**Honest limitation, to be written into `TESTING.md`'s not-locally-reproducible
table and the docs:** three resolvers behind one egress IP are only weakly
independent. They catch cache-state and propagation differences. They cannot see
GeoDNS, anycast, or network-path faults, and the docs must not imply otherwise.

**Verify:** the new fixture spec fails before the change and passes after;
`coverage.spec.ts` and `emission.spec.ts` pass with the registry entry removed.

---

### Phase 4 — Hysteresis and the state machine

The highest-stakes correctness property in the product (invariant 2). A
`domain.failed` webhook fired on one blip makes our customers page *their*
customers for nothing.

**Schema:** `domains.consecutive_failures` (integer, default 0, not null), plus a
new `state_transitions` table — `tenant_id`, `domain_id`, `from_state`,
`to_state`, `reason`, `evidence` (jsonb: the per-vantage verdicts at the moment it
fired), `created_at`.

That table is not an observation log. **A transition is a change**, so it belongs
under invariant 3 rather than fighting it, and a domain transitions a handful of
times in its life rather than 36 times a day. It exists because the thresholds
below are guesses: the first false alarm has to be auditable afterwards or the
receipt never arrives and the numbers stay guesses forever.

**`apps/api/src/domains/hysteresis.ts`** — a pure function over `(currentState,
consecutiveFailures, consensusVerdict, thresholds)`:

- `indeterminate` → **no state change, no counter change.** Uncertainty is not
  evidence of failure. This is already how `nextState` behaves and it must survive
  here.
- `pass`/`warn` → counter to 0; `verified`; `domain.recovered` if it was
  `degraded` or `failed`.
- `fail` → counter + 1. At `DEGRADED_AFTER_FAILURES` → `degraded`. At
  `FAILED_AFTER_FAILURES` → `failed`.

`degraded` fires its webhook **once per episode**: re-entering `degraded` from
`degraded` emits no event. The user chose to ship the `degraded` event over my
objection that "possibly nothing is wrong" trains people to ignore a channel;
once-per-episode is what keeps that objection from becoming true, since without it
a flapping domain emits an event every five minutes forever.

**Env:** `DEGRADED_AFTER_FAILURES` (1), `FAILED_AFTER_FAILURES` (3). Both marked
unmeasured, with the receipt named: "the observed distribution of consecutive
transient failures across real monitored domains over 30 days". Tunable without a
rebuild, because the first false alarm should cost a restart.

**Verify:** the pure function is table-tested across every state × verdict pair,
including the case that matters most — three alternating `fail`/`pass` results
never reach `failed`; an integration spec asserts one `state_transitions` row per
transition and none for a steady state.

---

### Phase 5 — Webhooks

**New package `packages/webhooks`** (private): `sign.ts` and `payload.ts` only.
Delivery is a BullMQ worker, so the package is the format and the signature —
kept separate because the signing scheme is the part a customer writes code
against, and it should be independently testable and independently documented.

Svix-compatible wire format, per DESIGN.md: `webhook-id`, `webhook-timestamp`,
`webhook-signature` (`v1,<base64 HMAC-SHA256>` over `{id}.{timestamp}.{body}`),
with a signed timestamp so a captured request cannot be replayed a week later.
Being Svix-compatible now means swapping in Svix later changes nothing for
customers.

**Rotation uses two active secrets.** `webhook_endpoints` carries `secret`,
`previous_secret` and `previous_secret_expires_at`; during the window every
request is signed with both and the header carries them space-separated —
`webhook-signature: v1,<new> v1,<old>` — which is exactly how the Svix format
expresses this, so a customer verifying against either one keeps working. A hard
swap would have been simpler and would have broken a customer for one request,
which is the wrong trade for the one operation you perform when you think a secret
has leaked.

**Schema:** `webhook_endpoints` (`tenant_id`, `url`, `secret`, `previous_secret`,
`previous_secret_expires_at`, `events[]`, `disabled_at`) and `webhook_deliveries`
(`tenant_id`, `endpoint_id`, `event`, `payload`, `status`, `attempts`,
`last_error`, `next_attempt_at`, `delivered_at`). The deliveries table is the
ledger and BullMQ is only the attempt mechanism — a row is written **before** a
job is enqueued, so a lost Redis loses attempts and never obligations.

**Events:** `domain.verified`, `domain.failed`, `domain.recovered`,
`domain.degraded`. Retries via BullMQ `attempts` + exponential `backoff`;
exhausted deliveries are dead-lettered with `status = 'failed'` and the last error
kept, and surfaced through the API rather than only in Workbench — "why did this
webhook not arrive" is a customer question, not an ops question.

**Routes:** `POST/GET/DELETE /v1/webhook-endpoints`, `POST
/v1/webhook-endpoints/:id/rotate-secret`, and `GET /v1/webhook-deliveries` with
the keyset pagination already established in `apps/api/src/routes/domains.ts`.
Secrets are returned once at creation, the same shape as API keys.

**Docs:** an `apps/docs` page covering the signature, verification code a customer
can paste, the two-secret rotation window, the retry schedule, and the
once-per-episode `degraded` rule stated plainly so nobody builds a pager on it.

**Verify:** signature verification tested against a fixed vector so a refactor
cannot silently change the scheme; a spec asserts both signatures are present and
independently valid during a rotation window and that the old one stops being
emitted after expiry; an integration spec runs a local HTTP server and asserts a
500 is retried while a 200 marks the row delivered; an `emission.spec.ts`-style
guard asserts every event constant appears in the docs page, matching how the
taxonomy and API reference are already kept honest.

---

### Phase 6 — Deployment, docs, and the receipts

The phase that turns the guesses into measurements. Nothing above ships a number
without a comment saying it is unmeasured; this closes that loop.

- **`DEPLOYING.md`**: a Redis section, the `worker` service, and Workbench access
  folded into the existing "Looking at the database" Tailscale section — it is the
  same `${…_BIND_ADDRESS:-127.0.0.1}` pattern, so it should read as one idea
  rather than two.
- **`.env.production.example`**: `REDIS_URL`, `WORKBENCH_*`,
  `WORKBENCH_BIND_ADDRESS`, `RESOLVER_ADDRESSES`, and every threshold, each with
  the same "measured / unmeasured" comment as the code.
- **Platform-agnostic, still.** Redis and the worker go in
  `docker-compose.prod.yml`; the Caddy overlay is untouched. Nothing here assumes
  Coolify, and nothing publishes a port the environment did not ask for.
- **`README.md`** and `docs/DESIGN.md`: monitoring moves from planned to shipped.
- **Measure and record**: worker + Redis RSS on the box, one tick's wall clock at
  the real domain count, and Unbound's latency under `CHECK_CONCURRENCY` parallel
  checks. Then revisit `SWEEP_BATCH_SIZE` and `CHECK_CONCURRENCY` with receipts
  attached, and correct any number that turns out to be wrong.

**Verify:** a from-scratch `docker compose -f docker-compose.prod.yml up` on a
clean checkout brings up postgres + redis + unbound + migrate + api + worker with
every healthcheck green; a domain registered through the public API transitions on
its own without anyone calling `/verify`; a webhook arrives at a real endpoint and
verifies against the documented snippet.

---

## Out of scope, deliberately

- **SOA-serial fast path.** Real and worth ~4–6x, but it is an optimisation for
  load we have not measured. Adaptive scheduling first.
- **The day-partitioned `checks` table.** DESIGN.md principle 4 mentions it;
  `state_transitions` plus `last_result` answers the diagnosability question at a
  fraction of the rows, and Databasus already takes scheduled dumps.
- **`TCP_SILENTLY_BLOCKED`.** Still needs a middlebox with `NET_ADMIN`.
- **GeoDNS / anycast detection.** One egress IP cannot see it. Phase 3 documents
  the limit rather than implying coverage.
- **Divergence on the public checker.** Reasonable follow-up; not worth tripling
  anonymous egress DNS in this milestone.
- **The dashboard.** Read surfaces exist in the API; a UI is its own milestone.
