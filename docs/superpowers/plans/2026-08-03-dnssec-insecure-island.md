# DNSSEC_INSECURE_ISLAND Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit `DNSSEC_INSECURE_ISLAND` for a subdomain delegated without a DS
beneath a zone its owner signed, without firing on the majority of the internet.

**Architecture:** A public-suffix guard is what makes the code shippable. The
registry's contract is *"this delegation is unsigned beneath a signed parent"*,
which is true of every unsigned domain under signed `.com` — so the parent must
first be shown to be a domain somebody **controls**, not a TLD. Detection is then
two lookups: no DS for the child, DNSKEY present at the parent. The fixture has to
be a genuine sub-delegation, which means re-signing `secure.test`.

**Tech Stack:** `@propgate/dns` (zero runtime dependencies, Node built-ins only),
the vendored Public Suffix List at `packages/dns/src/psl`, NSD + Unbound fixture
tier, `dnssec-signzone` via the pinned `internetsystemsconsortium/bind9:9.20`
container.

## Global Constraints

- **Never mock DNS.** Invariant 1. There is no stubbed-context shortcut for this;
  a fixture is the only honest path, which is why re-signing is in scope.
- **Zero runtime dependencies in `@propgate/dns`.** Node built-ins only.
- **Diagnosis codes are a public contract.** The implementation must match the
  registry summary, not the other way round. Getting this backwards is what
  produced the first wrong attempt.
- **Never report this as `DNSSEC_BOGUS`.** Bogus means re-sign or roll back and
  half the internet cannot reach you. An island resolves for everybody and the
  fix is a DS at the registrar. The remedies are opposite.
- `pnpm fix` before committing. Read command output in full rather than piping
  through `tail` — that has hidden failures in this repo twice.

## Why the obvious version was reverted

Shipped and reverted in `2f40950`. The detection was correct and the denominator
was not: `test.` is signed and most fixture children deliberately are not, so it
fired on the clean `customer.test` fixture —

```
AssertionError: expected [ 'DNSSEC_INSECURE_ISLAND', 'MX_NULL' ] to deeply equal [ 'MX_NULL' ]
```

`.com` is signed too, so the same code in production warns about most domains it
sees. `docs/DESIGN.md` already says why that is fatal: a checker that finds
something to fix on every domain is a checker nobody reads.

## File structure

| File | Responsibility |
|---|---|
| `packages/dns/src/evaluate/dnssec.ts` | Add `reportInsecureIsland`. Already holds `reportBogusIfServfail`; these two belong together because telling them apart is the whole point |
| `packages/dns/src/evaluate/delegation.ts` | Call it. Zone-level DNSSEC facts already land on the `delegation` check |
| `packages/dns-fixtures/zones/unsigned/island.secure.test.zone` | The unsigned child |
| `packages/dns-fixtures/zones/src/secure.test.zone` | Delegate the child. Signed source, so this forces a re-sign |
| `packages/dns-fixtures/src/expectations.ts` | Register the fixture against the code |
| `packages/dns/src/evaluate/dnssec.fixture.spec.ts` | Extend; the bogus describes already live here |
| `packages/dns/src/diagnosis/codes.ts` | Remove the `NOT_YET_EMITTED` entry |

---

### Task 1: The public-suffix guard and detection

**Files:**
- Modify: `packages/dns/src/evaluate/dnssec.ts`
- Modify: `packages/dns/src/evaluate/delegation.ts`

**Interfaces:**
- Consumes: `EvaluationContext.lookup({ name, type, purpose })` and
  `context.report(code, evidence)` from `./context`; `RecordType.DS` and
  `RecordType.DNSKEY` from `../wire/constants`; `recordsOfType(records, "DS")`
  from `../wire/message`; `getPublicSuffix(input): string | null` from
  `../psl`.
- Produces: `reportInsecureIsland(context: EvaluationContext, domain: string): Promise<void>`.

- [ ] **Step 1: Add the function**

Append to `packages/dns/src/evaluate/dnssec.ts`:

```ts
/**
 * A delegation left unsigned beneath a parent its owner signed.
 *
 * The guard below is the whole reason this is shippable. The registry's contract
 * — "this delegation is unsigned beneath a signed parent" — is satisfied by
 * every unsigned domain under `.com`, which is signed. Reported literally it is
 * a warning on most of the internet, and a checker that finds something on every
 * domain is one nobody reads.
 *
 * It becomes a real finding one level down: a subdomain somebody delegated
 * without a DS beneath a zone they signed themselves. They went to the trouble
 * and the child did not inherit it, which is also exactly the shape of the
 * delegation product in Phase 3.
 *
 * Never DNSSEC_BOGUS. An island resolves for everybody, nothing is broken today,
 * and the fix is a DS at the registrar rather than anything in the zone.
 */
export async function reportInsecureIsland(
  context: EvaluationContext,
  domain: string
): Promise<void> {
  const labels = domain.split(".");

  if (labels.length < 3) {
    // An org domain at best. Its parent is a public suffix, so the guard below
    // would reject it anyway — this just avoids two lookups to learn that.
    return;
  }

  const parent = labels.slice(1).join(".");

  // The guard. A parent that *is* a public suffix is a registry, not somebody
  // who chose to sign their zone, and its children inherit no expectation.
  if (getPublicSuffix(parent) === parent) {
    return;
  }

  const ds = await context.lookup({
    name: domain,
    purpose: "whether this delegation is signed, via the parent's DS",
    type: RecordType.DS,
  });

  if (ds.status !== "answered") {
    return;
  }

  if (recordsOfType(ds.message.answers, "DS").length > 0) {
    // Signed and vouched for. Nothing to say.
    return;
  }

  const parentKeys = await context.lookup({
    name: parent,
    purpose: "whether the parent is signed, which is what makes this a gap",
    type: RecordType.DNSKEY,
  });

  if (parentKeys.status !== "answered") {
    return;
  }

  if (recordsOfType(parentKeys.message.answers, "DNSKEY").length === 0) {
    // Unsigned under unsigned is the normal state of most of the internet.
    return;
  }

  context.report(DiagnosisCode.DNSSEC_INSECURE_ISLAND, {
    detail: `${parent} is signed and publishes no DS for this delegation, so DNSSEC protection stops at the boundary; nothing is broken today, and the fix is a DS record at the registrar rather than anything in the zone`,
    name: domain,
    observed: `no DS for ${domain}, and ${parent} publishes DNSKEY records`,
  });
}
```

Add to the imports at the top of the file:

```ts
import { getPublicSuffix } from "../psl";
import { RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
```

`Rcode` is already imported; keep it.

- [ ] **Step 2: Call it from the delegation evaluator**

In `packages/dns/src/evaluate/delegation.ts`, change the import:

```ts
import { reportBogusIfServfail, reportInsecureIsland } from "./dnssec";
```

and insert the call after the bogus early-return block, before
`const parent = await parentDelegation(context, domain);`:

```ts
  await reportInsecureIsland(context, domain);
```

Order matters and is already established: bogus first, because a bogus zone fails
every later question and reading the delegation first yields six symptoms whose
cause is one signature.

- [ ] **Step 3: Confirm the guard holds against existing fixtures**

```sh
pnpm dns:up
PROPGATE_FIXTURES=1 pnpm --filter @propgate/dns test
```

Expected: **545 passed**, unchanged. Specifically `customer.test` must stay
clean — its parent is `test`, which the PSL's implicit rule treats as a public
suffix, so the guard rejects it before any lookup. If `customer.test` reports the
code, the guard is not working and nothing else in this plan matters.

- [ ] **Step 4: Commit**

```sh
pnpm fix
git add packages/dns/src/evaluate/dnssec.ts packages/dns/src/evaluate/delegation.ts
git commit -m "feat(dns): guard insecure-island detection by public suffix"
```

---

### Task 2: The sub-delegation fixture

**Files:**
- Create: `packages/dns-fixtures/zones/unsigned/island.secure.test.zone`
- Modify: `packages/dns-fixtures/zones/src/secure.test.zone`
- Modify: `packages/dns-fixtures/src/expectations.ts`

**Interfaces:**
- Consumes: nothing from Task 1 at build time; the two are independent until
  Task 3.
- Produces: `island.secure.test` resolving with no DS, beneath a signed
  `secure.test`.

- [ ] **Step 1: Write the child zone**

`packages/dns-fixtures/zones/unsigned/island.secure.test.zone`:

```
; DNSSEC_INSECURE_ISLAND — a subdomain delegated without a DS beneath a zone its
; owner signed.
;
; The distinction that makes this worth a fixture: secure.test is signed and
; vouched for by test., and this child is not. Nothing here is broken — every
; resolver answers it — and the signatures above simply stop protecting anything
; at this boundary. The remedy is a DS at the registrar.
;
; It has to be a *sub*-delegation rather than an org domain. Reported at the org
; level the finding is true of every unsigned domain under signed .com, which is
; most of the internet, so the evaluator guards on the parent not being a public
; suffix. insecure-island.test exists for the org-domain case and correctly
; produces nothing under that guard.
$ORIGIN island.secure.test.
$TTL 300

@       IN SOA  ns1.test. hostmaster.propgate.invalid. (
                1 7200 3600 1209600 300 )
@       IN NS   ns1.test.

@                   IN TXT  "unsigned beneath a signed parent"
@                   IN A    198.51.100.110
```

- [ ] **Step 2: Delegate it from the signed parent**

Append to `packages/dns-fixtures/zones/src/secure.test.zone`:

```
; Delegated with NS and deliberately **no DS**, which is what makes the child an
; insecure island. Adding this to a signed source zone is why `pnpm dns:sign`
; has to run.
island              IN NS   ns1.test.
```

- [ ] **Step 3: Register the expectation**

Add to the array in `packages/dns-fixtures/src/expectations.ts`, next to the
existing `insecure-island.test` entry:

```ts
  {
    codes: ["DNSSEC_INSECURE_ISLAND"],
    reason:
      "A sub-delegation with no DS beneath a signed secure.test. The org-domain case cannot exercise the code, because the evaluator guards on the parent not being a public suffix — otherwise the finding is true of most of the internet.",
    role: "auth",
    zone: "island.secure.test",
  },
```

- [ ] **Step 4: Re-sign and reload**

```sh
pnpm dns:sign
pnpm dns:revision
pnpm dns:up --build
```

`dns:sign` prefers the pinned `internetsystemsconsortium/bind9:9.20` container
and falls back to local BIND tools; both are available. Expect a large diff — every
RRSIG in `secure.test.signed` is regenerated, and the `test.` and root zones are
re-signed because children are signed before parents with `dsset-*` threaded up.

- [ ] **Step 5: Verify the zone from outside before writing any spec**

```sh
dig +short @127.0.0.6 island.secure.test TXT     # "unsigned beneath a signed parent"
dig +short @127.0.0.6 island.secure.test DS      # (nothing)
dig +short @127.0.0.6 secure.test DNSKEY         # two keys
dig +short @127.0.0.6 secure.test DS             # one DS, from test.
```

All four must hold. If `secure.test DNSKEY` is empty the re-sign did not take; if
`island.secure.test TXT` is empty the delegation or the `nsd.conf` glob did not
pick up the new file.

- [ ] **Step 6: Commit**

```sh
git add packages/dns-fixtures
git commit -m "test(fixtures): a sub-delegation with no DS beneath a signed parent"
```

---

### Task 3: The spec, and retiring the deferral

**Files:**
- Modify: `packages/dns/src/evaluate/dnssec.fixture.spec.ts`
- Modify: `packages/dns/src/diagnosis/codes.ts`

**Interfaces:**
- Consumes: `reportInsecureIsland` via `evaluateDelegation` (Task 1), and
  `island.secure.test` (Task 2). The existing spec file already has a
  `context(role)` helper and a `codes(result)` helper — reuse both.

- [ ] **Step 1: Write the failing spec**

Insert into `packages/dns/src/evaluate/dnssec.fixture.spec.ts`, before the
`"a correctly signed zone"` describe:

```ts
describe("a delegation left unsigned beneath a signed parent", () => {
  it("is reported, because the parent went to the trouble and this did not", async () => {
    const result = await evaluateDelegation(context("resolver"), {
      domain: "island.secure.test",
    });

    expect(codes(result)).toContain(DiagnosisCode.DNSSEC_INSECURE_ISLAND);
  });

  it("reads as insecure, never as bogus", async () => {
    // It resolves for everybody. Nothing is broken today, and the fix is a DS at
    // the registrar — where bogus means re-sign or roll back.
    const result = await evaluateDelegation(context("resolver"), {
      domain: "island.secure.test",
    });

    expect(codes(result)).not.toContain(DiagnosisCode.DNSSEC_BOGUS);
  });

  it("names the signed parent, so the gap is obvious", async () => {
    const result = await evaluateDelegation(context("resolver"), {
      domain: "island.secure.test",
    });
    const finding = result.findings.find(
      (entry) => entry.code === DiagnosisCode.DNSSEC_INSECURE_ISLAND
    );

    expect(finding?.evidence.observed).toContain("secure.test");
    expect(finding?.severity).toBe("warning");
  });

  it("says nothing about an org domain under a signed TLD", async () => {
    // The guard, asserted directly. insecure-island.test satisfies the contract
    // as written — unsigned beneath signed `test.` — and reporting it would mean
    // reporting most of the internet.
    const result = await evaluateDelegation(context("resolver"), {
      domain: "insecure-island.test",
    });

    expect(codes(result)).not.toContain(DiagnosisCode.DNSSEC_INSECURE_ISLAND);
  });

  it("says nothing about a child that is properly vouched for", async () => {
    const result = await evaluateDelegation(context("resolver"), {
      domain: "secure.test",
    });

    expect(codes(result)).not.toContain(DiagnosisCode.DNSSEC_INSECURE_ISLAND);
  });
});
```

- [ ] **Step 2: Run it**

```sh
PROPGATE_FIXTURES=1 pnpm --filter @propgate/dns exec vitest run \
  --project dns-fixtures src/evaluate/dnssec.fixture.spec.ts
```

Expected: 13 passed. If the first test fails with the code absent, check the four
`dig` outputs from Task 2 Step 5 before touching the evaluator — the fixture is
the more likely fault.

- [ ] **Step 3: Retire the deferral**

Delete the `DNSSEC_INSECURE_ISLAND` entry from `NOT_YET_EMITTED` in
`packages/dns/src/diagnosis/codes.ts`. `emission.spec.ts` requires every code to
either be referenced in the source corpus or carry a reason, and it is now the
former.

- [ ] **Step 4: Full verification, output read in full**

```sh
pnpm fix
pnpm exec ultracite check
pnpm lint
PROPGATE_FIXTURES=1 PROPGATE_DATABASE=1 pnpm test --force
```

Expected: 7/7 tasks, dns at 550 passed. Read every line — piping through `tail`
has hidden failures in this repo twice.

- [ ] **Step 5: Commit and open the PR**

```sh
git add -A
git commit -m "feat(dns): emit DNSSEC_INSECURE_ISLAND for sub-delegations"
```

The PR body should carry the denominator argument, since that is the reviewable
decision rather than the two lookups: the contract as written is true of most of
the internet, the guard narrows it to somebody's own signed zone, and a spec
asserts the org-domain case stays silent.

---

## Self-review

**Coverage.** The guard is Task 1, the fixture Task 2, the specs and the
`NOT_YET_EMITTED` retirement Task 3. The regression that caused the revert —
firing on `customer.test` — is asserted in Task 1 Step 3 and again in Task 3 Step 1's
fourth test. Nothing in the brief is unassigned.

**Placeholders.** None. Every code block is complete; the two `dig` blocks carry
their expected output.

**Consistency.** `reportInsecureIsland(context, domain)` is named identically in
the interfaces block, the implementation, and the call site. `island.secure.test`
is the zone name in the file path, the `$ORIGIN`, the expectation, and all five
tests.

**One risk worth naming.** Task 2 Step 4 regenerates every signature in the
fixture tier, so the diff is large and mostly generated. `zones.spec.ts` asserts
source delegations appear in the signed copy, which is the guard that catches a
partial re-sign — a stale signed root served an old `test.zone` once before in
this project, and that spec exists because of it.
