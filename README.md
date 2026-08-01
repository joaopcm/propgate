# propgate

Domain onboarding and lifecycle infrastructure. Companies hand us their customers' domains; we verify the DNS, keep watching it, and tell them via webhooks when anything changes.

> **Status:** design phase. Nothing is built yet. This document is the scope contract — read it before adding anything.

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

Customers define a versioned **domain profile** once — the set of records their product requires, including conditional requirements. We render per-domain instructions from it, evaluate them semantically, and return machine-readable diagnosis codes rather than booleans.

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
- Domain profiles: versioned, conditional requirements
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

## RFC conformance

<!-- conformance:start -->

**65 of 71 catalogued requirements** (91%).

| RFC | | Implemented | |
| --- | --- | --- | --- |
| [RFC 1034](https://www.rfc-editor.org/rfc/rfc1034) | Domain names — concepts and facilities | 4 / 4 | 100% |
| [RFC 1035](https://www.rfc-editor.org/rfc/rfc1035) | Domain names — implementation and specification | 5 / 5 | 100% |
| [RFC 2181](https://www.rfc-editor.org/rfc/rfc2181) | Clarifications to the DNS specification | 1 / 2 | 50% |
| [RFC 2308](https://www.rfc-editor.org/rfc/rfc2308) | Negative caching of DNS queries | 2 / 2 | 100% |
| [RFC 4035](https://www.rfc-editor.org/rfc/rfc4035) | Protocol modifications for DNSSEC | 0 / 1 | 0% |
| [RFC 4343](https://www.rfc-editor.org/rfc/rfc4343) | Domain name system case insensitivity clarification | 1 / 1 | 100% |
| [RFC 5321](https://www.rfc-editor.org/rfc/rfc5321) | Simple Mail Transfer Protocol | 1 / 1 | 100% |
| [RFC 6376](https://www.rfc-editor.org/rfc/rfc6376) | DomainKeys Identified Mail (DKIM) signatures | 10 / 10 | 100% |
| [RFC 7208](https://www.rfc-editor.org/rfc/rfc7208) | Sender Policy Framework (SPF) | 24 / 27 | 88% |
| [RFC 7489](https://www.rfc-editor.org/rfc/rfc7489) | Domain-based Message Authentication, Reporting and Conformance (DMARC) | 8 / 8 | 100% |
| [RFC 7505](https://www.rfc-editor.org/rfc/rfc7505) | A null MX resource record | 2 / 2 | 100% |
| [RFC 8463](https://www.rfc-editor.org/rfc/rfc8463) | Ed25519 signatures for DKIM | 1 / 1 | 100% |
| [RFC 8659](https://www.rfc-editor.org/rfc/rfc8659) | DNS Certification Authority Authorization (CAA) | 6 / 7 | 85% |

The denominator is our reading of which normative statements apply to a
verifier — something that inspects a domain's records and reports on them.
It is not a percentage of an RFC's text, which is not a computable number:
most of RFC 7208 instructs senders and receiving MTAs, and none of that is
ours to implement. Requirements that do not apply are listed in the ledger
with a reason and excluded from the denominator, so cataloguing more of what
an MTA does cannot improve the figure.

Every requirement marked implemented names a test that must exist and must
assert it; `conformance.spec.ts` fails the build otherwise. The table is
generated from that ledger and CI rejects the README if it has drifted.

### What we do not do

- **RFC 2181 §5.2** — All records in an RRset carry the same TTL. Every record in an RRset should carry the same TTL, and a mismatch is a real provider fault. No evaluator compares them yet, so nothing would notice — the resolver keeps per-record TTLs, so this is reachable without new plumbing.
- **RFC 4035 §5** — Validating the DNSSEC chain of trust for an answer. We rely on the resolver we query, and read the AD bit it sets. Validating the chain ourselves would mean shipping a trust anchor and a validator, which is Phase 2 work at the earliest — the fixture tier already carries signed, bogus and insecure-island zones for it.
- **RFC 7208 §5.5** — Evaluating whether a ptr mechanism matches a given client. Deciding one needs a reverse lookup of the connecting address and a forward confirmation of every name it returns. We report the term as undetermined for a specific sender rather than guessing, which is visible as SPF_IP_UNDETERMINED.
- **RFC 7208 §6.2** — Fetching and macro-expanding exp= text on a fail. exp= text is fetched only to build a rejection message after the outcome is already decided, so it changes no verdict. Parsing the modifier is implemented; retrieving and expanding the explanation string is not.
- **RFC 7208 §7.3** — Expanding the %{p} macro. It is the validated domain name of the connecting address, which needs the same reverse lookup and forward confirmation as the ptr mechanism. §7.3 advises against publishing it. Reported as unevaluable rather than guessed.
- **RFC 8659 §5** — A CA must consider the DNSSEC validation state of the RRset. The DNSSEC state of the CAA RRset is what a CA must consider. We rely on the resolver's validation rather than validating ourselves — see the DNSSEC entries.

<!-- conformance:end -->

## Design principles

1. **Diagnosis codes are the product.** `PROVIDER_APPENDED_ZONE_NAME` deflects a support ticket; "record not found" creates one. The taxonomy is the thing competitors can't copy quickly and it doubles as our content marketing.
2. **Never mock DNS in tests.** Run a real authoritative server with fixture zones covering the ugly cases. Mocking responses hides exactly the bugs the taxonomy exists to catch. (Same rule shape as "never mock Postgres.")
3. **No per-invocation pricing in the sweep path.** A continuous polling loop is the worst possible fit for serverless billing. One long-running process. No serverless anything between the scheduler and the resolver.
4. **Store changes, never observations.** Update `last_checked_at` / `last_result` in place; append to `record_changes` only on actual change; keep a day-partitioned `checks` table with 7-day retention for debugging. Logging every check result is how a $20 bill becomes a $400 one.
5. **Semantics over string matching.** Evaluate SPF like an MTA would. Parse DKIM keys. Climb the CAA tree.
6. **Escape hatches always.** A raw lookup API by vantage point, so nobody feels trapped.
7. **State is not a boolean.** `pending → verifying → verified → degraded → failed`, with explicit transition rules.

## Cost model

Infra cost is a hard constraint — this is bootstrapped with no customers. Feature scope barely affects the bill; architecture does.

| Phase | Monthly |
|---|---|
| Phase 1 (checker + library) | ~$20 |
| Phase 2 (API + dashboard + monitoring + 3 vantage points) | ~$30–40 |
| Phase 3 (delegation, multi-node authoritative) | ~$250 |

Two things that would break this:

- **Hosted authoritative DNS is priced per zone.** Every delegated `pg.example.com` is its own zone, so Route 53 at 100k domains is ~$10,000/mo. The authoritative fleet must be self-hosted (Knot or PowerDNS with a DB backend) from day one of Phase 3.
- **Logging every check result.** See principle 4.

Three product decisions that *are* the infra bill:

1. **Adaptive scheduling** — `pending` polls every 30s for 15 min then backs off; `verified` + stable 30 days polls daily; floor at the observed TTL. Roughly 10x cheaper than uniform sweeping and better UX.
2. **SOA serial fast path** — check the zone's serial before checking six records in it. One query instead of six, ~4–6x reduction. Cloudflare and Route 53 bump it reliably; some providers don't, so full-verify daily regardless.
3. **Retention discipline** — see principle 4.

## Roadmap

| Phase | Deliverable | Cost | Gate |
|---|---|---|---|
| **0** ([#1](https://github.com/joaopcm/propgate/issues/1)) | Monorepo scaffolding, CI, CLAUDE.md, docker-compose with DNS fixtures | — | — |
| **1** ([#2](https://github.com/joaopcm/propgate/issues/2)) | `@propgate/dns` + diagnosis taxonomy + free public checker + CLI | ~$20/mo | [#3](https://github.com/joaopcm/propgate/issues/3) — **do 3 companies say they'd pay for this as an API?** If not, stop |
| **2** ([#4](https://github.com/joaopcm/propgate/issues/4)) | API + webhooks + dashboard + monitoring + SDK (minimum sellable product) | ~$30–40/mo | [#5](https://github.com/joaopcm/propgate/issues/5) — **is anyone converting to paid?** |
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

Arriving in Phase 2, deliberately not before — issue [#3](https://github.com/joaopcm/propgate/issues/3)'s gate may end the project, and the point of the phasing is not to pre-build a control plane that may never ship:

```
packages/{db,auth,shared,jobs,webhooks,sdk,ui,emails}
```

`packages/dns` is the engine for the public checker, the API, and the CLI — one implementation, three surfaces.

## Getting started

```sh
pnpm install
pnpm dns:up                      # NSD + Unbound fixture tier, six roles
pnpm lint                        # tsc --noEmit across the workspace
pnpm test                        # static + unit specs, no containers needed
PROPGATE_FIXTURES=1 pnpm test    # adds the fixture-backed projects
```

macOS needs the override, since only `127.0.0.1` is up on Darwin:

```sh
docker compose -f docker-compose.yml -f docker-compose.darwin.yml up -d --wait
```

See [`TESTING.md`](./TESTING.md) for how the DNS fixture harness works, what it can and cannot reproduce, and why `fileParallelism` stays on here.

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

## License

`packages/dns` and the SDKs are MIT — they're the credibility and the top of funnel. The control plane, dashboard, and monitoring scheduler are source-available. The moat is the infrastructure footprint (multi-provider authoritative fleet, multi-vantage-point resolver network), not the source code.
