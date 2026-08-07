# Design

The scope contract. What propgate is for, why the hard parts are hard, what is
deliberately not being built, and what it may cost.

Read this before adding anything. [`README.md`](../README.md) is the product;
this is the reasoning underneath it.

## The problem

Every SaaS that asks customers to configure DNS rebuilds the same system badly:

- A set of custom records the customer must add (SPF, DKIM, DMARC, MX, return-path, tracking CNAME, ownership TXT)
- A polling system to detect when they've been added
- Periodic sweeper jobs to detect regressions when records are later deleted or changed
- Conditional lookups (CAA before cert issuance, MX presence before requiring inbound records)
- A support burden, because DNS providers mangle records in a dozen provider-specific ways

Anyone can build a version of this that works for 80% of domains in two weeks. The last 20% takes two years. **propgate is the last 20%.**

## Why this is hard

DNS is a caching, inconsistent, occasionally lying distributed system. The failure modes that matter:

- **Negative caching** poisons early checks — an NXDOMAIN cached for the SOA minimum can hide a correct record for an hour
- **CNAME flattening** (Cloudflare) — the customer adds a CNAME, you observe an A record
- **Zone-name appending** — `selector._domainkey.example.com.example.com`, likely the single most common support ticket in this space
- **Wildcard records cause false-positive verification** — `*.example.com TXT` makes every lookup succeed. Without wildcard-synthesis detection you will mark unconfigured domains as verified
- **TXT mangling** — values split at 255 chars, requoted, or truncated. 2048-bit DKIM keys exceed 512 bytes and force TCP fallback, which some middleboxes drop
- **DNSSEC-bogus zones** SERVFAIL to validating resolvers and resolve fine everywhere else
- **GeoDNS and partial propagation** mean a single vantage point is not enough
- **Semantics, not string matching** — SPF has a 10-lookup limit and a 2-void-lookup limit and needs recursive `include:` expansion; DMARC is only valid at the org domain (PSL+1) and external report destinations need `_report._dmarc` authorization; CAA needs RFC 8659 tree climbing; MTA-STS is a DNS record *plus* an HTTPS policy fetch
- **DKIM base64 is case-sensitive** while DNS names are not

Plus the hardest correctness property, which has nothing to do with lookups:

> **Regression detection needs hysteresis.** Firing `domain.failed` because one resolver blipped makes our customers page *their* customers for nothing. That makes the product worse than not existing. Consensus across vantage points **and** consecutive-failure thresholds, with a `degraded` state distinct from `failed`, is non-negotiable.

## How it works

### Verification (v1)

Customers define a versioned **domain profile** once — the set of records their
product requires, including conditional requirements. We evaluate them
semantically and return machine-readable diagnosis codes rather than booleans.

A profile states the *shape*; a domain supplies the *values*. That split is
load-bearing rather than cosmetic. Some of what a platform expects is issued per
domain — the DKIM key for `acme.com` is not the one for `globex.com` — so a
requirement names those fields in `requiredPerDomain` and each domain carries them
in `expectations`. Without it a tenant with ten thousand domains needs ten
thousand profile versions and the versioning stops meaning anything. A value the
profile did not ask for is ignored, so nothing a domain sends can widen what it is
checked against; a value it did ask for and did not get makes the domain
`indeterminate`, never `pass`.

We deliberately **do not** render per-domain instructions. Every integrator
already has a UI telling their customer what to paste, and being wrong about a
provider's naming conventions should be visible to them rather than to us. What
we return is which requirements are unmet and the DNS name each belongs at.

Two verification modes with deliberately different SLOs:

| Mode | Trigger | Behavior |
|---|---|---|
| Interactive | `POST /v1/domains/:id/checks` | Cache-busting, authoritative-first, sub-second. Backs the customer's "Verify" button |
| Continuous | Background sweeper | Cheap, cached, TTL-aware, adaptive interval by state |

### Delegation (v2)

The long-term differentiator. Instead of six copy-pasted records, the customer adds one delegation and we own the subtree:

```
pg.example.com.   NS    ns1.propgate.com. (+ ns2, ns3, ns4)
example.com.      TXT   "v=spf1 include:spf.propgate.com ~all"
```

Everything we need lives under the delegated zone — `_domainkey.pg.example.com`, `bounce.pg.example.com`, `link.pg.example.com`. DKIM `d=pg.example.com` still passes DMARC because relaxed alignment (`adkim=r`, the default) only requires the org domain to match.

**Full email setup in two records, one of which never changes again.** Key rotation, new selectors, and future record types need zero customer action, and there is almost nothing left for a customer to accidentally delete.

Constraints to design around:

- The apex cannot be delegated. Apex SPF, MX, and CAA stay copy-paste
- `adkim=s` and BIMI need exact `d=`, so a "canonical" mode delegates `_domainkey` / `bounce` separately
- Some DNS providers refuse subdomain NS records, especially on underscore labels. **Delegation is the preferred path, never the only one** — the copy-paste path and the full diagnosis taxonomy are permanent
- If the parent zone is signed, a delegation without a DS record becomes an insecure island. Detect and explain it

Delegation is deliberately **not** in v1. It requires enormous trust (our nameservers going down breaks our customers' customers' email) and that trust has to be earned by shipping something lower-risk first. Read-only verification earns it.

## Scope

### v1 — in scope

- `@propgate/dns`: resolver, semantic record evaluators, diagnosis taxonomy (open source, published, zero runtime deps)
- Free public domain checker + CLI, built on the same engine
- REST API (`/v1`) with scoped API keys and a Stripe-shaped `{ data, error, meta }` envelope
- Domain profiles: versioned, conditional requirements, with per-domain values
- Continuous monitoring with adaptive scheduling and hysteresis
- Record change timeline — "the customer deleted the DKIM record Tuesday at 14:02"
- Webhooks on state transitions, [standard-webhooks](https://www.standardwebhooks.com/) compatible
- Full dashboard
- Three resolver vantage points
- TypeScript SDK
- Sandbox with forced-state simulation

### v1 — explicitly out of scope

| Deferred | Why |
|---|---|
| Delegation / authoritative DNS | Needs trust we haven't earned, plus 24/7 ops maturity and multi-node infra |
| TLS certificates | Delegation is the prerequisite; delivery to the customer's terminator is the real scope explosion |
| Svix Cloud | Self-hosted or our own sender. The wire format stays Svix-compatible so swapping in Svix later changes nothing for customers |
| ClickHouse | Store transitions and changes, not observations. Postgres is sufficient for years |
| Domain Connect / one-click record writing | High value, but it's expansion, not wedge |
| Multi-region HA | Acceptable to skip *only because* v1 is read-only — if we go down, the customer falls back to their own polling and nothing of theirs breaks |
| MTA-STS, BIMI, DMARC external report authorization | Nobody is asking yet |
| 200-provider deep links | Ship ~15 providers for ~90% coverage |

## Design principles

1. **Diagnosis codes are the product.** `PROVIDER_APPENDED_ZONE_NAME` deflects a support ticket; "record not found" creates one. The taxonomy is the thing competitors can't copy quickly and it doubles as our content marketing.
2. **Never mock DNS in tests.** Run a real authoritative server with fixture zones covering the ugly cases. Mocking responses hides exactly the bugs the taxonomy exists to catch. (Same rule shape as "never mock Postgres.")
3. **No per-invocation pricing in the sweep path.** A continuous polling loop is the worst possible fit for serverless billing. One long-running process. No serverless anything between the scheduler and the resolver.
4. **Store changes, never observations.** Update `last_checked_at` / `last_result` in place; append to `record_changes` only on actual change; keep a day-partitioned `checks` table with 7-day retention for debugging. Logging every check result is how a $20 bill becomes a $400 one.
5. **Semantics over string matching.** Evaluate SPF like an MTA would. Parse DKIM keys. Climb the CAA tree. Comparing against an expected value is not an exception to this: we parse first and compare the *parsed* field, so `DKIM_KEY_MISMATCH` is a comparison of two public keys rather than of two TXT records, and it can tell "a different key" from "the same key, differently split" — which a regex over the record cannot.
6. **Escape hatches always.** A raw lookup API by vantage point, so nobody feels trapped.
7. **State is not a boolean.** `pending → verifying → verified → degraded → failed`, with explicit transition rules.

## Cost model

Infra cost is a hard constraint — this is bootstrapped with no customers. Feature scope barely affects the bill; architecture does.

| Phase | Monthly |
|---|---|
| Phase 1 (checker + library) | ~$20 |
| Phase 2 (API + monitoring + 3 vantage points) | ~$30–40 |
| Phase 3 (delegation, multi-node authoritative) | ~$250 |

Two things that would break this:

- **Hosted authoritative DNS is priced per zone.** Every delegated `pg.example.com` is its own zone, so Route 53 at 100k domains is ~$10,000/mo. The authoritative fleet must be self-hosted (Knot or PowerDNS with a DB backend) from day one of Phase 3.
- **Logging every check result.** See principle 4.

Three product decisions that *are* the infra bill:

1. **Adaptive scheduling** — `pending` polls every 30s for 15 min then backs off; `verified` + stable 30 days polls daily; floor at the observed TTL. Roughly 10x cheaper than uniform sweeping and better UX.
2. **SOA serial fast path** — check the zone's serial before checking six records in it. One query instead of six, ~4–6x reduction. Cloudflare and Route 53 bump it reliably; some providers don't, so full-verify daily regardless.
3. **Retention discipline** — see principle 4.

## Where Phase 2 landed

Shipped and deployed: the authenticated API, versioned profiles, domain
registration and on-demand verification, a continuous sweeper on an adaptive
schedule, consensus across three vantage points, the hysteresis state machine
with `degraded` reachable, and signed webhooks with a delivery ledger.

Shipped after that, and the piece that makes the gate below reachable by someone
who has not spoken to us: **self-serve accounts.** `POST /v1/signup` mails a
six-digit code, `POST /v1/signup/confirm` exchanges it for a key, and
`/v1/api-keys` manages the rest — all of it reachable from `@propgate/cli`. Until
this landed, evaluating propgate required sending an email and waiting for a
human, which is a strange thing to ask of a platform assessing whether to depend
on us.

Two consequences worth recording, because both changed the shape of the product
rather than being details:

- **The default quotas came down.** Every key used to be handed out
  deliberately; now anybody with an email address gets one. 30,000 requests a
  minute became 250 a second — the same order of magnitude on average, a very
  different burst — and 600 verifications a minute became 100, because a check
  aims up to twenty queries at authoritative servers *the caller* names.
  `tenants.request_quota_per_second` raises it for an account we have vetted.
- **A tenant is no longer a single identity.** The address that signed up lives
  on `tenant_members`, not on `tenants`, because a tenant is an integration that
  will eventually have several people on it. Roles are a column on that table
  when they are needed; nothing about `tenants` has to move.

Three things in Phase 2's original scope did not ship, each for a stated reason.
The **dashboard** and the **SDK**: the API is the product for a platform
integrating us, and neither changes whether anyone pays. The **day-partitioned
`checks` table**: `state_transitions` plus `last_result` answers the
diagnosability question at a fraction of the rows.

**The gate is now answerable, and answerable without us in the loop.**
[#5](https://github.com/joaopcm/propgate/issues/5) asks whether anyone converts to
paid, and there is now something to convert onto and a way to reach it unaided.
That question is not an engineering one, and no amount of further building
answers it — which is the whole reason the phasing puts a gate here rather than
rolling straight into Phase 3's ~$250/month authoritative fleet.

What remains inside Phase 2 is measurement rather than construction. Every
threshold the sweeper and the state machine depend on ships commented as
unmeasured, with the measurement that would justify it named next to it. Two of
them — the consecutive-failure thresholds and the webhook retry budget — need
roughly a month of real monitored domains, and that clock started at deploy.

One exception to that, found after shipping rather than deferred: **expected
values lived in the wrong place.** A DKIM key is issued per domain, but the field
holding it was on the profile — a versioned template many domains pin — so
asserting "this domain publishes *the* key we issued it" cost one profile version
per domain. The mechanism above is the correction, and it is a gap being closed
rather than scope being added: no new check kind, nothing new the resolver can do.

Two check kinds that the problem statement at the top of this document names and
this document then never picks up remain unbuilt: an **ownership TXT** token and a
**tracking CNAME** target. Both are expected-value checks, and the token is one
that can only ever be per-domain — which is why the mechanism had to come first.
Neither is new scope for the same reason expected values were not; they are the
rest of the record set on line 13.

## Roadmap

| Phase | Deliverable | Cost | Gate |
|---|---|---|---|
| **0** ([#1](https://github.com/joaopcm/propgate/issues/1)) | Monorepo scaffolding, CI, CLAUDE.md, docker-compose with DNS fixtures | — | — |
| **1** ([#2](https://github.com/joaopcm/propgate/issues/2)) | `@propgate/dns` + diagnosis taxonomy + free public checker + CLI | ~$20/mo | [#3](https://github.com/joaopcm/propgate/issues/3) — **do 3 companies say they'd pay for this as an API?** If not, stop |
| **2** ([#4](https://github.com/joaopcm/propgate/issues/4)) | API + webhooks + monitoring (minimum sellable product) — **shipped** | ~$30–40/mo | [#5](https://github.com/joaopcm/propgate/issues/5) — **is anyone converting to paid?** |
| **3** ([#6](https://github.com/joaopcm/propgate/issues/6)) | Delegation — authoritative DNS, one-record onboarding | ~$250/mo | Requires revenue and a track record |
| **4** ([#7](https://github.com/joaopcm/propgate/issues/7)) | Certificates — ACME DNS plugins first, managed issuance later | — | Requires Phase 3 |
| **5** ([#8](https://github.com/joaopcm/propgate/issues/8)) | Domain Connect — one-click record writing | — | Any time after Phase 2 |

Phase 1 exists to be **cheaply falsifiable**. If two months of a live public checker produces no traffic and no inbound, we've spent about $40 and learned something important before committing eight months.

## Architecture

Scaffolded now (Phase 0), covering everything Phase 1 needs:

```
propgate/
├── apps/
│   ├── api/          # Hono resolver service. Long-running by design.
│   ├── web/          # Next.js — marketing + the public checker
│   └── docs/         # Next MDX — the taxonomy, rendered from the registry
├── packages/
│   ├── dns/           # @propgate/dns — resolver, evaluators, taxonomy (MIT, published)
│   ├── dns-fixtures/  # zone files, DNSSEC signing pipeline, test harness (private)
│   └── cli/           # @propgate/cli (MIT, published)
├── docker/dns/       # NSD + Unbound image, one per role
└── docker-compose.yml
```

Arrived with Phase 2:

```
packages/{db,jobs,webhooks}
```

Still not built, and deliberately so — the phasing exists so a control plane that
may never ship is not pre-built, and that reasoning holds for everything left on
the list:

```
packages/{auth,shared,sdk,ui,emails}
```

The dashboard and the SDK were in Phase 2's original scope and are **not** in what
shipped. Both were dropped rather than deferred by accident: the API is the
product for a platform integrating us, and neither a UI nor a typed client
changes whether somebody will pay for it. That is what the gate below asks, and
answering it with less code is the point.

`packages/dns` is the engine for the public checker, the API, and the CLI — one implementation, three surfaces.

## Planned stack

| Component | Technology |
|---|---|
| Monorepo | Turborepo, pnpm workspaces, Node 24 |
| API | Hono, tsup (ESM) |
| Dashboard / Docs | Next.js 16, React 19, tRPC, Tailwind 4, Base UI + shadcn |
| Auth | Better Auth (orgs, API keys, Stripe) |
| Database | PostgreSQL 18, Drizzle ORM |
| Queue / Scheduler | BullMQ + ioredis, Workbench for queue admin |
| Env validation | `@t3-oss/env-core` + Zod |
| Secrets | Infisical |
| Lint / Format | Biome via Ultracite |
| Testing | Vitest, real NSD + Unbound fixture tier (Postgres + Redis from Phase 2) |
| Observability | evlog → Axiom, Sentry, PostHog |
| Releases | Changesets (publishes `@propgate/dns` and `@propgate/sdk`) |

