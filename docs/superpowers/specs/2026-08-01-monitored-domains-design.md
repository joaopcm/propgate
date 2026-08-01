# Monitored domains — Phase 2, milestone 1

**Status:** approved, not started
**Supersedes nothing. Narrows:** issue #4

## Why this exists, and why it is not issue #4

Issue #4 is the whole minimum sellable product: API, webhooks, monitoring and a
dashboard, six to eight weeks, none of it usable until most of it exists.

Gate #3 asked whether anyone wants the control plane before building it. That
question now has a partial answer — one design partner is interested — which
changes the gate rather than clearing it. The question is no longer *"does
anybody want this"* but *"what is the narrowest thing that gets one partner to
production"*, and that is a different and much smaller build.

This milestone answers the first half of it. A partner can register their
customers' domains against a profile, ask us whether each is correctly
configured, and see exactly which requirement is unmet. It does not watch
anything yet.

## Decisions taken, and what they rule out

| Decision | Consequence |
|---|---|
| The partner keeps the domain list; they register domains with us | No dashboard. They render results in their own UI. |
| Tens of thousands of domains from day one | Sweep economics are load-bearing before the sweeper exists. |
| Verification first, monitoring second | Two milestones. This is the first. |
| Multi-tenant from the start | Tenancy in the schema now, not retrofitted. |
| Report what is unmet, not what to paste | Profiles are in scope. Per-provider instruction rendering is not. |

**Multi-tenant now** costs roughly a week over single-tenant and avoids the
worst refactor available to us: adding a tenant column to every table and
auditing every query at the point where real customer data is already in them.

**No instruction rendering** because the partner already has UI that tells their
customer what to add. Competing with it needs per-provider naming conventions to
be worth anything, and being wrong there is visible to their end customer.

## Integration: shadow mode

The partner already verifies domains at onboarding. This milestone deliberately
competes with code they have, which is a risk they accepted knowingly.

The way to de-risk it is to run alongside rather than instead: the partner sends
us the same domains their own verification handles and compares the two
verdicts, switching nothing. Disagreements become evidence rather than
incidents, and we find out whether we are strictly better *before* anybody
depends on us.

Nothing in the design has to change to allow this. It is worth stating because
it is the reason the ordering is safe.

## Architecture

```
partner backend ──POST /v1/domains──────▶  apps/api
                ──POST /v1/domains/:id/checks──▶  (Hono, one long-running process)
                ◀──── per-requirement results ──┤        │
                                                         ▼
                                                    Postgres
                                       domains · profiles · record_changes
```

One process on a VPS, one managed Postgres, nothing else. Milestone 1 is
entirely request-driven, so the box is idle most of the time — but it is the
same process the sweeper will live in, which is why it is a VPS rather than a
function. Invariant 4 in `.claude/CLAUDE.md`: no serverless between the
scheduler and the resolver.

New: `packages/db` (Drizzle schema and migrations). Extended: `apps/api`
(authentication, domain and profile routes). Unchanged: `packages/dns`.

### A naming collision to settle before writing code

`@propgate/dns` already exports `DomainProfile`, meaning *which checks to run*.
The stored thing is different: a tenant's versioned record-set requirement, with
an identity per requirement so results can be reported against it.

The stored one is a **Profile** with `requirements[]`. It **compiles down** to
the `DomainProfile` the pipeline already accepts. Two layers, one word — the
boundary has to be explicit in the types or it will rot.

## Data model

```
tenants ──< api_keys
        ├──< profiles          (versioned: a new version is a new row)
        └──< domains ──< record_changes   (appended only on actual change)
                 └── references a profile *version*
```

| Table | Columns that matter |
|---|---|
| `tenants` | id, name |
| `api_keys` | tenant_id, `hash`, display `prefix`, `last_used_at`, `revoked_at` |
| `profiles` | tenant_id, key, `version`, `definition` jsonb |
| `domains` | tenant_id, name, `profile_version_id`, `external_id`, `state`, `last_checked_at`, `last_result` jsonb, `next_check_at` |
| `record_changes` | domain_id, `requirement_key`, `previous`, `current`, `observed_at` |

Text primary keys with `uuidv7()`, a pgEnum for state, following the conventions
already used across the workspace.

### Four decisions doing real work

**Profiles are version-pinned per domain.** A domain references a profile
*version*, not a profile. Otherwise editing a profile silently reclassifies
every domain using it at once, and the first anyone hears of it is a webhook
storm in milestone 2.

**Per-requirement results live in `last_result` jsonb, updated in place.** A row
per requirement per domain is tens of thousands of rows churning on every sweep,
which is invariant 3 — *store changes, never observations* — violated on day
one.

**`record_changes` is appended only when an observed value actually differs.**
This is the write pattern the milestone exists to prove. It is the difference
between a $20 bill and a $400 one, and it cannot be retrofitted once a sweeper
is hammering it.

**Two columns exist before anything reads them.** `next_check_at` is the column
the sweeper's query will be built on, and adding it later means backfilling tens
of thousands of rows. The state enum carries all five values —
`pending → verifying → verified → degraded → failed` — even though this
milestone can only reach three, so milestone 2 does not migrate an enum.

Unique constraints: `(tenant_id, name)` and `(tenant_id, external_id)`.

## API

Bearer authentication. Keys are stored hashed with a display prefix kept for
listing. Responses use the existing `{ data, error, meta }` envelope.

| Endpoint | Does |
|---|---|
| `POST /v1/profiles` | Create a profile **version** |
| `GET /v1/profiles/:key` | The current version |
| `POST /v1/domains` | **Register only.** No DNS. State `pending` |
| `POST /v1/domains/:id/checks` | **Verify.** Runs the checks, updates state, returns results |
| `GET /v1/domains/:id` | Last known state and per-requirement results |
| `GET /v1/domains/:id/timeline` | `record_changes` for the domain |
| `DELETE /v1/domains/:id` | Stop tracking |

**Registration and verification are separate calls.** Registration is a write;
verification is an action with latency and side effects. Importing tens of
thousands of domains must not fire tens of thousands of DNS runs as a side
effect of a bulk insert, and a registration that is slow because DNS is slow is
a registration that times out for reasons unrelated to registering.

`external_id` is unique per tenant, and re-registering an existing one returns
the existing domain rather than erroring. That is a friendlier idempotency story
than idempotency keys for a first milestone, and it removes the mapping table on
the partner's side.

A domain must name a profile at registration. There is no unprofiled domain:
without one there is nothing to check it against, and allowing the state would
mean every later code path has to handle it.

### State, in this milestone

```
        register              check passes
pending ────────▶ pending ──────────────▶ verified
                     │                        │
                     │ check fails            │ check fails
                     ▼                        ▼
                  failed  ◀───────────────  failed
```

Only three of the five states are reachable here. `verifying` is not used —
checks are synchronous within one request, so nothing observes the intermediate
state. `degraded` requires hysteresis and arrives with the sweeper.

An indeterminate check is not in this diagram on purpose: it is not an edge. The
state is left exactly as it was.

`DELETE` matters more than it looks: at tens of thousands of domains, with no
way to stop tracking, the sweeper in milestone 2 inherits every domain the
partner ever had.

## Profiles and per-requirement results

A profile is a list of requirements, each with a stable key:

```json
{
  "key": "sending",
  "requirements": [
    { "key": "spf",   "check": "spf",   "include": "_spf.partner.example" },
    { "key": "dkim",  "check": "dkim",  "selector": "pg1" },
    { "key": "dmarc", "check": "dmarc" },
    { "key": "mail",  "check": "mx",    "expectsMail": false }
  ]
}
```

It compiles to a `DomainProfile`, plus a mapping from findings back to
requirement keys. A result reports `3 of 4 requirements met`, and per
requirement the findings with their `observed` and `expected` values — which is
"what is wrong or missing" without an instruction renderer.

Requirement types are limited to what the evaluators already assert: an SPF
include, a DKIM selector with an optional expected key, DMARC present and valid,
MX with a stated mail intent, and a CAA issuer.

### Two things this needs that do not exist

**Per-selector DKIM outcomes.** `runChecks` currently merges multiple DKIM
selectors into one outcome, deliberately — "is DKIM set up" is not a
per-selector question. Per-requirement results need them split. A small change
to `packages/dns/src/check/run.ts`, but a change to existing behaviour, so it
needs its own specs.

**A minimum DMARC policy cannot be required.** The evaluator reports `p=none` as
a warning; it cannot assert "must be at least quarantine". That is a plausible
partner ask and is deliberately left out rather than built on speculation.

## Failure handling

**`indeterminate` never causes a state transition.** A domain whose check could
not complete keeps its current state. `last_checked_at` moves, `last_result`
records the uncertainty, and nothing is appended to `record_changes`.

Every layer beneath this already preserves the distinction between "broken" and
"could not tell" — four verdicts in the evaluators, a distinct exit code in the
CLI, a 200 with `indeterminate` from the public API. This is where it either
survives into the product or quietly dies, and milestone 2's hysteresis is built
directly on top of it.

Beyond that: a domain that cannot be checked at all — a public suffix, a
malformed name — is rejected with 422 and never stored. Rate limits are per
tenant.

## Testing

Route specs need a real database, so this adds **Postgres to the test tier** —
the first time the repo has needed one. A compose service and a gating pattern
alongside `PROPGATE_FIXTURES`, following the same rule that already governs DNS:
never mock the thing whose behaviour you are relying on.

`TESTING.md` warns against copying a Postgres-driven `fileParallelism: false`
into the DNS specs. The reverse now also applies: DNS fixtures are read-only and
parallel, a shared Postgres is not, and the two need separate projects rather
than one shared setting.

What must have a test:

- Tenancy isolation — one tenant cannot read or delete another's domain. Asserted
  per route, not once.
- `record_changes` is appended on a real change and **not** appended when a
  re-check observes the same values.
- An indeterminate check leaves `state` untouched and appends nothing.
- Re-registering an `external_id` returns the existing domain.
- A profile edit creates a new version and leaves existing domains pinned.

## Out of scope, deliberately

The sweeper, hysteresis and webhooks — that is milestone 2, and this milestone
exists partly to make its write path safe. The dashboard. Instruction rendering.
The day-partitioned `checks` table: with no sweeper there is no volume, and its
partitioning design belongs with the thing that fills it.

## Suggested PR sequence

This is more than one pull request. A reviewable order, each landing green:

1. `packages/db` — schema, migrations, and Postgres in the test tier. No routes.
   The load-bearing decisions are all here and reviewing them alone is the point.
2. Authentication — API keys, hashing, tenant scoping, per-tenant rate limits,
   with the isolation specs that must exist before any data route does.
3. Profiles — the definition, versioning, and compilation to `DomainProfile`,
   including the per-selector DKIM split in `packages/dns`.
4. Domain routes — register, check, read, timeline, delete.

Steps 1 and 2 have no user-visible behaviour and are still the two worth the
most care.

## Open questions

None blocking. Two to settle with the partner before milestone 2:

- Whether a minimum DMARC policy needs to be requirable.
- Which events they want, and whether `domain.degraded` is useful to them or
  just noise between `verified` and `failed`.
