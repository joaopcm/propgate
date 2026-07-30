# Testing guide

Read this before adding or changing tests.

The runner is [Vitest](https://vitest.dev). Specs live next to the code they
cover. Run everything with `pnpm test`, or one package with
`pnpm --filter <pkg> test`.

## The core rule: never mock DNS

Query the real fixture tier. A mocked resolver agrees with whatever you believed
when you wrote the mock, and every failure mode in the diagnosis taxonomy is
something that surprised somebody. Mangled TXT splits, wildcard synthesis, TC
bits, DNSSEC state, the authority-section SOA of an NXDOMAIN — none of these
survive being stubbed.

```sh
pnpm dns:up                      # NSD + Unbound, six roles
PROPGATE_FIXTURES=1 pnpm test
```

The one sanctioned exception is `packages/dns-fixtures/src/ready.ts`, which uses
`node:dns` for liveness probing. That is fine for "is the server up"; it is
useless for anything the taxonomy cares about, because c-ares cannot expose the
TC bit, set DO, control the EDNS buffer size, or return RRSIGs. Do not reach for
`node:dns` in the resolver or the evaluators.

## Spec file naming

| Pattern | Project | Needs containers | Parallel |
|---|---|---|---|
| `*.spec.ts` | `dns`, `api`, … | no | yes |
| `*.fixture.spec.ts` | `dns-fixtures` | yes | yes |
| `*.serial.spec.ts` | `dns-serial` | yes | **no** |

`*.fixture.spec.ts` and `*.serial.spec.ts` are collected only when
`PROPGATE_FIXTURES=1`. CI sets it after `docker compose up --wait`, so every PR
runs them.

Gating on an env var rather than on reachability is deliberate: a suite that
silently skips when the servers are down is worse than one that fails, because
the skip looks like a pass.

## fileParallelism stays on — and why that differs from Postgres

The usual monorepo pattern is `fileParallelism: false`, because a shared Postgres
is mutable state and parallel files trample each other.

**Do not copy that here.** The DNS fixtures are read-only, stateless zone files.
Nothing contends. Turning parallelism off would slow the suite for no benefit.

Two things genuinely are shared mutable state, and they get the `dns-serial`
project:

- **Unbound's cache.** Most cache-sensitive assertions should use
  `uniqueLabel()` for a fresh QNAME instead, which needs no coordination at all.
  Reserve an explicit cache flush for `*.serial.spec.ts`.
- **Zone mutation.** Anything that rewrites a zone and reloads a server.

## Structure

- **One `describe()` per unit under test**, named for the real thing
  (`"evaluateDkim"`, `"GET /health"`), so a failure points straight at the code.
- **`it()` names an observable behaviour**, phrased as a continuation of the
  describe: `it("reports PROVIDER_APPENDED_ZONE_NAME when the record sits at <name>.<zone>")`.
- **Keep it flat.** Sibling `describe()` blocks over nesting.
- **Assertions go inside `it()`**, never in `describe()` bodies or hooks.

## Determinism

- No sleeps, no polling, no arbitrary timeouts. Assert on results and persisted
  state.
- Fixture queries use a 250 ms deadline (`FIXTURE_QUERY_TIMEOUT_MS`). Timeout-bound
  fixtures are where wall-clock time and flakiness enter a suite, so there is
  exactly one blackhole fixture (`stale.test`, whose second nameserver at
  `127.0.0.9` has nothing listening) and it fails fast via ICMP port-unreachable.
- Prefer REFUSED-based fixtures over blackholes. `lame.test` is delegated to
  `dns-decoy`, which is authoritative for `decoy.test` only and so refuses
  instantly.
- Never commit `.only` or `.skip`.

## Adding a fixture

1. Write the zone file under `packages/dns-fixtures/zones/unsigned/`.
2. Delegate it from `zones/src/test.zone`.
3. Add a row to `src/expectations.ts` with the codes it produces and why it exists.
4. `pnpm dns:revision && pnpm dns:up`.
5. If it needs to be signed, put the source in `zones/src/`, add it to
   `CHILDREN` in `scripts/sign.sh`, and run `pnpm dns:sign`.

`zones.spec.ts` will fail if you skip step 2 or 3, and `coverage.spec.ts` will
fail if you add a diagnosis code without either a fixture or a written reason.

## The staleness canary

`dns-auth` publishes the content hash of `zones/` as `_rev.canary.test TXT`, and
globalSetup compares it against the committed `REVISION`. Editing a zone file and
forgetting to reload is the single most common way to lose an afternoon to this
kind of harness; the canary turns it into one actionable line.

## What is not locally reproducible

Flag these rather than quietly pretending they are covered. Each is recorded in
`NOT_LOCALLY_REPRODUCIBLE` in `packages/dns/src/diagnosis/codes.ts` with a reason,
and the coverage spec requires the reason to be substantive.

| Not reproducible | Closest local approximation |
|---|---|
| **GeoDNS, anycast, true partial propagation** | `dns-divergent` serves different answers, which is what the consensus logic consumes. Real geographic behaviour is out of reach. |
| **Wall-clock TTL and negative-cache expiry** | The repo bans sleeps. The computed TTL from the authority-section SOA is asserted directly; expiry arithmetic is unit-tested against an injectable clock. |
| **A middlebox silently dropping TCP/53** | Needs `NET_ADMIN` and an iptables DROP in a bridged container. Without it you get ECONNREFUSED, a different timing profile. Optional Phase 1 fixture. |
| **Provider mangling that never reaches DNS** | Nothing observable. Permanently out of scope. |
| **Real public-resolver quirks** | Would need network access from CI. If ever wanted, put them in `*.live.spec.ts` excluded by default. |

## Regression tests

When fixing a bug:

1. Write a test that reproduces it against the real fixtures and watch it **fail**.
2. Apply the fix and watch it **pass**.
3. Name it for the behaviour, not the ticket, so it reads as a permanent guarantee.

If you cannot make it fail first, you have not reproduced the bug yet.

## Before opening a PR

- `pnpm lint` and `pnpm test` pass
- `PROPGATE_FIXTURES=1 pnpm test` passes with the tier up
- `./packages/dns-fixtures/scripts/check-zones.sh` passes
- `pnpm fix` applied
