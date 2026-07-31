# @propgate/dns

DNS resolver, semantic record evaluators, and a machine-readable diagnosis
taxonomy. **Zero runtime dependencies** — Node built-ins only.

MIT licensed. Part of [propgate](https://github.com/joaopcm/propgate).

> **Status:** the wire codec and transports are in place. Evaluators (SPF, DKIM,
> DMARC, CAA, MTA-STS) and the full ~50-code taxonomy are the rest of Phase 1.

## Why this does not use `node:dns`

Node's `dns.Resolver` wraps c-ares, which cannot express things this library
exists to report on. Each row below maps to at least one diagnosis code:

| Needed for | `node:dns` |
|---|---|
| The **TC bit** — was the answer truncated? | Not exposed. An oversized DKIM key is indistinguishable from a missing record |
| **DO bit / RRSIG records** | Cannot set DO; never returns RRSIGs, so no DNSSEC state and no `Labels` wildcard signal |
| **Authority-section SOA of an NXDOMAIN** | Discarded, so the RFC 2308 negative-cache TTL cannot be computed |
| **Advertised EDNS buffer size** | Not controllable, so truncation cannot be driven from the client |
| **REFUSED vs SERVFAIL vs NXDOMAIN** | Collapsed into error codes that lose the distinction |
| **AA flag** | Not exposed, so a lame delegation is invisible |

Combined with the zero-dependency promise (the package is the credibility
artifact and the top of the funnel), that leaves encoding and decoding DNS
messages ourselves over `node:dgram` and `node:net`.

The trade is deliberate: ~2 kLOC of wire format, checked against a fixture tier
of deliberately broken servers, in exchange for being able to see everything on
the wire.

## Usage

```ts
import { query, RecordType } from "@propgate/dns";

const outcome = await query({
  target: { address: "198.51.100.1", port: 53 },
  name: "selector._domainkey.example.com",
  type: RecordType.TXT,
});

if (outcome.status === "answered") {
  console.log(outcome.retriedOverTcp, outcome.message.flags.ad);
}
```

### Outcomes are values, not exceptions

A timeout, a refusal, and a mangled response are *observations about a domain*,
not exceptional conditions in your program. `query` returns a discriminated
union — `answered`, `truncated`, `timeout`, `unreachable`, `malformed` — so a
single `catch` cannot flatten "the server was slow" into "the record is missing".

### Truncation

By default a truncated UDP answer is retried over TCP, which is what a resolver
must do for a 4096-bit DKIM key. Pass `retryOverTcp: false` to observe the TC bit
instead.

Omitting `ednsBufferSize` sends **no OPT record at all**, which caps the response
at 512 bytes by RFC 1035. That is the only way to exercise truncation from the
client rather than by tuning the server, and it is not a micro-optimisation —
passing any value, even a small one, changes the semantics.

Measured, since it is easy to get wrong: a 2048-bit DKIM key is a **483-byte**
response and does **not** truncate. 4096-bit keys (~752 bytes) do.

### The Public Suffix List

`getPublicSuffix`, `getRegistrableDomain`, and `isPublicSuffix` implement the
[publicsuffix.org algorithm](https://publicsuffix.org/list/) against a vendored
copy of the list, checked in `psl.spec.ts` against that project's own 82 test
vectors.

Matching happens in ASCII against punycoded rules, but results are sliced from
the caller's own labels — a unicode input gets a unicode answer, which is what
the vectors require and what a customer wants to read in a diagnosis.

**`includePrivate` defaults to true**, and it changes real answers.
`user.github.io` is an organizational domain with private rules included and
collapses to `github.io` without them. Included is what DMARC alignment needs
and what mail implementations do, because the question is who *controls* a name
rather than who registered it.

Refresh with `pnpm --filter @propgate/dns psl:refresh`; CI runs `psl:check` to
prove the vendored file is exactly what the generator produces. There is
deliberately no staleness check — failing because upstream moved would break
unrelated PRs for a reason their author cannot fix.

**Cost:** the vendored list is ~196 KB of the package's ~228 KB CJS bundle.
That is the price of the zero-dependency promise; `psl` and `tldts` carry
comparable data, they just carry it as a dependency.

### Everything is port-aware

Addresses are `{ address, port, transport }` and `port` is never assumed to be
53. Root hints are injectable via `ResolverOptions`, because the test harness
serves a fake signed root and production serves the real one.

## Contributing

One rule dominates: **never call the reader inside an object literal.** Object
properties evaluate in source order, so a formatter that sorts keys
alphabetically silently reorders the reads and corrupts every byte after the
first field. This has happened here once already — `SOA` became
`expire/hostmaster/minimum/primary/…` instead of wire order, and only the
fixture tests caught it. Read into locals in wire order, then build the object.

Tests need the fixture tier:

```sh
pnpm dns:up
PROPGATE_FIXTURES=1 pnpm --filter @propgate/dns test
```

See [`TESTING.md`](../../TESTING.md) for what the harness can and cannot
reproduce.
