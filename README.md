# propgate

**Domain verification that tells you what is wrong, not just that something is.**

Companies whose customers configure DNS — email platforms, custom domains,
anything with a "verify your domain" screen — rebuild the same brittle checker.
This is the part they never get to: the semantics, the provider quirks, and the
difference between *broken* and *we could not tell*.

MIT-licensed library and CLI. Source-available API. Runs on one small server.

## See it

No signup, no key:

```sh
curl -s -X POST https://api.propgate.dev/v1/checks \
  -H 'content-type: application/json' -d '{"domain":"github.com"}'
```

That returns two findings on a domain nobody would call misconfigured:

```
spf         warn    SPF_LOOKUP_LIMIT_NEAR   0 of the ten lookups are left
delegation  warn    NS_SERIAL_MISMATCH      … at 1656468023; … at 1
```

GitHub's SPF sits at exactly the ten DNS lookups RFC 7208 allows. It works
today, and the next `include:` anyone adds breaks mail delivery — with no error
at the moment of the edit. Separately, their AWS and NS1 nameservers report
different zone serials, so which answer a customer gets depends on which server
they happen to reach.

Neither is findable with a regex over a TXT record. That is the whole argument.

**[Quickstart →](QUICKSTART.md)** · **[API reference →](https://docs.propgate.dev/api)**
· **[Every diagnosis code →](https://docs.propgate.dev/taxonomy)**

## What you get

- **73 diagnosis codes**, each a stable contract you can switch on, each either
  reproduced by a fixture in the test harness or carrying a written reason why
  it cannot be. `PROVIDER_APPENDED_ZONE_NAME` deflects a support ticket;
  "record not found" creates one.
- **Semantics, not string matching.** SPF expanded recursively the way an MTA
  does it, with the ten-lookup and two-void-lookup limits counted. DKIM keys
  parsed. The CAA tree climbed per RFC 8659.
- **Four verdicts, not two.** `pass`, `warn`, `fail`, and `indeterminate` —
  because "this is broken" and "we could not tell" are different answers, and
  collapsing them is how a monitoring product pages someone at 3am over its own
  bad second.
- **The derivation, not just the verdict.** Every result carries the lookups
  behind it: which name, which server, what came back.

## What ships today

| | |
|---|---|
| [`@propgate/dns`](https://www.npmjs.com/package/@propgate/dns) | Resolver, semantic evaluators, the taxonomy. **Zero runtime dependencies** — Node built-ins only |
| [`@propgate/cli`](https://www.npmjs.com/package/@propgate/cli) | `npx @propgate/cli check example.com` |
| [propgate.dev](https://propgate.dev) | The free public checker |
| [api.propgate.dev](https://docs.propgate.dev/api) | Register domains against a versioned profile, verify them, read per-requirement results and a change timeline |
| Self-serve keys | `POST /v1/signup` then `POST /v1/signup/confirm` — an emailed code for a key, in two calls and no conversation |
| Continuous monitoring | Domains are re-checked on an adaptive schedule without anyone asking. Consensus across three vantage points, hysteresis before anything is called failed |
| [Webhooks](https://docs.propgate.dev/webhooks) | `domain.verified`, `domain.degraded`, `domain.failed`, `domain.recovered` — signed, Svix-compatible, at-least-once with a queryable delivery ledger |

## Where this is going

Verification answers *is this domain configured correctly right now*. The
product is the rest of the lifecycle.

| | Status |
|---|---|
| Verification — checks, taxonomy, CLI, public checker | **shipped** |
| Self-serve accounts — sign up by email, get a key, manage keys | **shipped** |
| Registration and on-demand verification via API | **shipped** |
| Continuous monitoring — sweeper, consensus across vantage points, hysteresis, webhooks | **shipped** |
| Delegation — you delegate `pg.example.com` to us, one record instead of six | planned |
| Certificates, Domain Connect | later |

Monitoring was the interesting one, and the hard part was a correctness property
rather than a scheduling problem:

> Firing `domain.failed` because one resolver blipped makes our customers page
> *their* customers for nothing. That needs consensus across vantage points
> **and** consecutive-failure thresholds, with `degraded` distinct from
> `failed`.

Both are in. A domain is checked from three vantage points concurrently and a
single disagreeing one yields `indeterminate` rather than a failure; `failed`
needs consecutive failures, so alternating failure and recovery never reaches it.

The thresholds are still numbers nobody has measured, and the code says so at
every one of them along with what would earn the receipt. `state_transitions`
stores the per-vantage evidence behind every state change precisely so the first
false alarm can be audited and those numbers can stop being guesses.

[`docs/DESIGN.md`](docs/DESIGN.md) is the scope contract: the problem, why DNS
makes it hard, what is deliberately out of scope, the cost model, and the
roadmap with its gates.

## RFC conformance

<!-- conformance:start -->

**69 of 74 catalogued requirements** (93%).

| RFC | | Implemented | |
| --- | --- | --- | --- |
| [RFC 1034](https://www.rfc-editor.org/rfc/rfc1034) | Domain names — concepts and facilities | 4 / 4 | 100% |
| [RFC 1035](https://www.rfc-editor.org/rfc/rfc1035) | Domain names — implementation and specification | 5 / 5 | 100% |
| [RFC 2181](https://www.rfc-editor.org/rfc/rfc2181) | Clarifications to the DNS specification | 2 / 2 | 100% |
| [RFC 2308](https://www.rfc-editor.org/rfc/rfc2308) | Negative caching of DNS queries | 2 / 2 | 100% |
| [RFC 4035](https://www.rfc-editor.org/rfc/rfc4035) | Protocol modifications for DNSSEC | 0 / 1 | 0% |
| [RFC 4343](https://www.rfc-editor.org/rfc/rfc4343) | Domain name system case insensitivity clarification | 1 / 1 | 100% |
| [RFC 5321](https://www.rfc-editor.org/rfc/rfc5321) | Simple Mail Transfer Protocol | 1 / 1 | 100% |
| [RFC 6376](https://www.rfc-editor.org/rfc/rfc6376) | DomainKeys Identified Mail (DKIM) signatures | 10 / 10 | 100% |
| [RFC 6891](https://www.rfc-editor.org/rfc/rfc6891) | Extension mechanisms for DNS (EDNS(0)) | 2 / 2 | 100% |
| [RFC 7208](https://www.rfc-editor.org/rfc/rfc7208) | Sender Policy Framework (SPF) | 25 / 28 | 89% |
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

- **RFC 4035 §5** — Validating the DNSSEC chain of trust for an answer. We rely on the resolver we query, and read the AD bit it sets. Validating the chain ourselves would mean shipping a trust anchor and a validator, which is Phase 2 work at the earliest — the fixture tier already carries signed, bogus and insecure-island zones for it.
- **RFC 7208 §5.5** — Evaluating whether a ptr mechanism matches a given client. Deciding one needs a reverse lookup of the connecting address and a forward confirmation of every name it returns. We report the term as undetermined for a specific sender rather than guessing, which is visible as SPF_IP_UNDETERMINED.
- **RFC 7208 §6.2** — Fetching and macro-expanding exp= text on a fail. exp= text is fetched only to build a rejection message after the outcome is already decided, so it changes no verdict. Parsing the modifier is implemented; retrieving and expanding the explanation string is not.
- **RFC 7208 §7.3** — Expanding the %{p} macro. It is the validated domain name of the connecting address, which needs the same reverse lookup and forward confirmation as the ptr mechanism. §7.3 advises against publishing it. Reported as unevaluable rather than guessed.
- **RFC 8659 §5** — A CA must consider the DNSSEC validation state of the RRset. The DNSSEC state of the CAA RRset is what a CA must consider. We rely on the resolver's validation rather than validating ourselves — see the DNSSEC entries.

<!-- conformance:end -->

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

| Read next | |
|---|---|
| [`docs/DESIGN.md`](docs/DESIGN.md) | The scope contract — why this is hard, what is out of scope, the roadmap |
| [`TESTING.md`](./TESTING.md) | The DNS fixture harness, what it cannot reproduce, and why `fileParallelism` stays on |
| [`DEPLOYING.md`](./DEPLOYING.md) | Running it yourself: static front ends, one box for the API |
| [`.claude/CLAUDE.md`](./.claude/CLAUDE.md) | The invariants. Each exists because getting it wrong ships something worse than nothing |

## License

`packages/dns` and the SDKs are MIT — they're the credibility and the top of funnel. The control plane, dashboard, and monitoring scheduler are source-available. The moat is the infrastructure footprint (multi-provider authoritative fleet, multi-vantage-point resolver network), not the source code.
