# Self-Serve Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Each phase is one PR.

**Goal:** A stranger can get a working API key without anyone at propgate doing
anything — `signup` → OTP email → `confirm` → key — and can manage their keys
afterwards, all of it reachable from the CLI.

**Architecture:** Two unauthenticated endpoints guarded by rate limits and an
attempt cap, one `otp_codes` table holding hashes rather than codes, and a
`/v1/api-keys` family mirroring `/v1/webhooks`. Email goes out through Resend from
a new `packages/emails`. The CLI stores the key in a `0600` config file and grows
three commands.

**Tech Stack:** Hono, Drizzle, `resend`, `node:crypto`, existing `@propgate/db`
key helpers.

---

## Context

`mintTenantKey` exists and is reachable only by someone with a shell on the box:
`docker compose exec api node dist/mint.js "Partner" "key"`. That was right while
onboarding meant a conversation. It is now the thing standing between the Phase 2
gate — *does anyone convert to paid* — and the answer, because a platform
evaluating us cannot try it without emailing first.

What already exists and must be reused rather than rebuilt:

| Existing | Where |
|---|---|
| `createApiKey`, `revokeApiKey`, `authenticateApiKey` | `packages/db/src/queries/api-keys.ts` |
| `listApiKeys`, `apiKeysMatching`, `activeApiKeyCount`, `revokeApiKeyByReference` | `packages/db/src/queries/revocation.ts` |
| `mintTenantKey` (tenant + first key, transactional) | `packages/db/src/queries/onboard.ts` |
| `generateApiKey`, `hashApiKey`, `API_KEY_PREFIX` | `packages/db/src/keys.ts` |
| `RateLimiter` (in-memory token bucket) | `apps/api/src/utils/rate-limit.ts` |
| The `/v1/webhooks` family, as the shape to copy | `apps/api/src/routes/webhooks.ts` |

`packages/emails` is on `.claude/CLAUDE.md`'s "do not add early" list. This is the
thing that justifies it; update that list in the same PR.

## Two risks that shape the design

Neither is a detail to handle later. Both change what gets built.

### 1. Open signup changes the resolver's abuse surface

Today every API key was handed out deliberately. After this, anybody with an email
address gets one, and `TENANT_REQUESTS_PER_MINUTE` is **30,000** — a number chosen
when a tenant meant a partner we had spoken to. `CHECKS_PER_TENANT_PER_MINUTE` is
600, and a check is up to ~20 upstream queries aimed at whatever authoritative
servers the caller names.

So a self-serve tenant is a way to point our resolver at somebody else's
infrastructure at 12,000 queries a minute. That is not a hypothetical: it is what
open DNS tooling gets used for.

**Therefore self-serve tenants need their own quota tier, lower than a partner's,**
and the limit has to be a column on `tenants` rather than one constant for
everybody. Sizing it is a decision, not a measurement — see the open questions.

### 2. The OTP email is a way to make us send mail to strangers

`POST /v1/signup` with an arbitrary address makes propgate send email to it. Left
unguarded that is a spam relay with our sending reputation attached, and the
consequence is our domain being blocklisted — which breaks the product for
everybody, permanently and slowly.

**Therefore:** hard per-IP and per-address rate limits, a global hourly ceiling on
outbound signup mail, and no resend-on-demand endpoint in v1. An address that
already has a pending code gets the *same* code re-sent at most once per minute
rather than a new one.

---

## Phases

### Phase 1 — `packages/emails` and the OTP store

No endpoints. The two pieces everything else needs, both testable on their own.

**`packages/emails`** — private, one dependency (`resend`).

- `src/client.ts` — `createMailer(apiKey)`, returning a small interface with one
  method. An interface rather than the Resend client directly, so the API can be
  tested against a recording fake without stubbing HTTP and without a network
  call in CI. **This is the one sanctioned fake in this plan**; unlike DNS or
  Redis, there is nothing to learn from a real third-party send and doing it in
  CI would mail somebody.
- `src/otp.ts` — the message. Plain text plus minimal HTML, the code in the
  subject as well as the body (mail clients preview subjects, and a code you can
  read without opening the mail is a real usability win), and an explicit
  "somebody may have typed your address by mistake; you can ignore this" line.
- No React Email. One transactional message does not justify a renderer and a
  build step; revisit if a second message ever appears.

**`otp_codes`** in `packages/db/src/schema/otp-codes.ts`:

| Column | Why |
|---|---|
| `email` | Lowercased and trimmed on the way in, so `A@b.com` and `a@b.com` are one account |
| `code_hash` | **A hash, never the code.** A leaked database must not be a way into every pending account, and we never need to display it |
| `attempts` | The brute-force bound. Six digits is 10^6, which is minutes of guessing without a cap |
| `expires_at` | Ten minutes |
| `consumed_at` | Single use, enforced by a conditional update rather than a read-then-write |
| `sent_at` | So a re-request can re-send the same code instead of minting a new one |
| `created_at` | |

Unique on `email` where `consumed_at is null` — one live code per address, so
requesting again cannot fan out into a hundred valid codes.

Queries in `packages/db/src/queries/otp.ts`:

- `issueCode(db, { email, codeHash, expiresAt })` → `{ code: "issued" | "resent" }`,
  upserting on the live row. `resent` is what the route uses to decide whether to
  send mail again.
- `consumeCode(db, { email, codeHash })` → `"consumed" | "invalid" | "expired" | "exhausted"`.
  **One statement**: `update … set consumed_at = now() where email = … and
  code_hash = … and consumed_at is null and expires_at > now() returning …`. A read
  followed by a write lets two concurrent confirms both win.
- Increment `attempts` on a failed match, and return `exhausted` past the cap.

**Verify:** `otp.db.spec.ts` covers a happy consume, a wrong code incrementing
attempts, an expired code, the cap, a second consume of the same code failing, and
two concurrent consumes yielding exactly one `consumed`.

---

### Phase 2 — `POST /v1/signup` and `POST /v1/signup/confirm`

**`POST /v1/signup`** — `{ email }`.

Always returns **202 with the same body**, whether or not the address is known.
Anything else is an account-enumeration oracle: a signup form that says "already
registered" tells an attacker which of a leaked address list uses us.

Guards, in order:
1. Per-IP limiter (a `RateLimiter` instance) — the spam control.
2. Per-address limiter — one send per minute, re-sending the existing code.
3. A global hourly counter — the blocklist backstop. When it trips, still return
   202 and log loudly; a stranger must not be able to tell they hit a ceiling.

**`POST /v1/signup/confirm`** — `{ code, email }`.

On `consumed`, in one transaction: find or create the tenant for that address, then
mint a key. Returns the key **once**.

**What "idempotent" means here, precisely.** The code is single-use, so a literal
retry of the same request returns 409 `code already used`. Idempotency is at the
*tenant* level: the address maps to at most one tenant, forever. Running the whole
flow again on an address that already has a tenant mints an **additional** key
against the same tenant rather than a second account — which doubles as the
account-recovery path for somebody who lost their key, and is the reason no
separate sign-in flow is needed in v1.

That trade is worth stating plainly: **anyone who controls the email address can
mint a key.** That is the same security model as every password-reset flow, and it
is why the OTP guards above are the actual security boundary.

`tenants` gains `email` (unique, nullable — existing rows have none) and
`request_quota_per_minute` (nullable; null means the partner default). The signup
path sets the self-serve tier; `mint.js` continues to set null.

**Files:** `apps/api/src/routes/signup.ts`, `packages/db/src/queries/onboard.ts`
(extend with `findOrCreateTenantForEmail`), `packages/db/src/schema/tenants.ts`,
`apps/api/src/app.ts` (mount unauthenticated, and **do not** add to the auth
middleware list — `webhooks.db.spec.ts` learned that lesson in the other
direction).

**Verify:** `signup.db.spec.ts` — identical response for known and unknown
addresses, the per-address re-send returning the same code, confirm minting exactly
one tenant and one key, a second confirm 409ing, a wrong code counting an attempt,
the cap, case-insensitive email matching, and a second full flow on the same
address producing a second key against the *same* tenant.

---

### Phase 3 — `/v1/api-keys`

Mirrors `/v1/webhooks`, and the queries already exist.

```
POST   /v1/api-keys        create; returns the secret once
GET    /v1/api-keys        list — prefix, name, created, last used, revoked
DELETE /v1/api-keys/:id    revoke
```

Two rules carried over from `keys.ts`, which already implements both and is the
reason that CLI exists:

- **A tenant cannot revoke its last active key.** Doing so locks itself out with
  no self-serve way back, and `activeApiKeyCount` is already there for it. `force`
  is not exposed over HTTP — an operator with a shell can still do it.
- **Never return a stored secret.** Only creation returns one, exactly as
  `/v1/webhooks` handles endpoint secrets.

Authenticating a key-management call with the key being revoked is fine; revoking
the key you are holding is the normal "rotate away from a leaked key" move and
must keep working.

**Verify:** `api-keys.db.spec.ts` — create returns a usable key, list never
includes a secret, revoke works and the key then 401s, revoking the last key is
refused with a message naming why, and cross-tenant ids 404.

---

### Phase 4 — the CLI flow

`packages/cli` currently has exactly one command (`check`) and no notion of
credentials. This adds the smallest thing that works.

```
propgate signup --email me@example.com
propgate confirm --email me@example.com --code 123456     # stores the key
propgate keys list | keys create <name> | keys revoke <prefix>
propgate domains add <domain> --profile <key>             # optional, see questions
```

- Config at `$XDG_CONFIG_HOME/propgate/config.json`, mode **0600**, holding
  `{ apiKey, apiUrl }`. Created with the mode set, not chmodded afterwards — the
  window between the two is a real leak on a shared machine.
- `--api-url` and `PROPGATE_API_URL` override, so the CLI works against a local
  stack.
- `PROPGATE_API_KEY` beats the config file, for CI.
- `confirm` prints the key **and** says it is stored and will not be shown again.
- Zero new runtime dependencies: `@propgate/cli` is published and MIT, and `fetch`
  plus `node:fs` cover all of this.

**Verify:** unit specs for the config path and permissions, argument parsing per
the existing `args.spec.ts`, and one spec asserting the file is created `0600`.

---

## Global constraints

- **Never mock DNS or Redis.** The mailer is the single sanctioned fake, and only
  because a real send in CI would mail a real person.
- **Never store a secret or a code in plaintext.** Hashes only, compared with
  `timingSafeEqual`.
- **Never leak whether an address is registered.** Identical responses, identical
  timing where practical.
- **Every limit is a tripwire with a written reason.** No number lands without a
  comment saying what it is protecting and what would justify a different value.
- `pnpm fix` before committing. Read command output in full.
- No artifact names the design partner.

## Out of scope

- **Passwords, sessions, a dashboard login.** The API key *is* the credential.
- **A sign-in endpoint.** Re-running signup on a known address is the recovery
  path, which is enough for v1 and one fewer surface to secure.
- **Teams, invites, multiple humans per tenant.** A tenant is an integration, not
  an organisation.
- **Billing.** The gate asks whether anyone *would* pay, and that conversation
  does not need a card form.
- **`packages/auth`.** Better Auth solves problems this does not have.

## Open questions

1. **Self-serve quota** — what should `request_quota_per_minute` and the checks
   limit be for an unvetted tenant? Partners get 30,000/min and 600 checks/min. I
   would start at 600/min and 60 checks/min and raise on request, but this is a
   product call about how generous free is.
2. **Is signup gated at all?** Fully open, or an allowlist/invite code while the
   gate question is being answered? Open maximises the chance somebody tries it;
   closed removes the spam-relay risk entirely.
3. **Sending domain** — send from `propgate.dev` or a subdomain like
   `mail.propgate.dev`? A subdomain keeps a blocklisting incident away from the
   apex, which matters given risk 2.
4. **OTP length and TTL** — 6 digits / 10 minutes, or 8 digits / 15? Six is
   friendlier to type and the attempt cap is what actually bounds guessing.
5. **Does the CLI get `domains add`?** It makes the "whole flow via CLI" complete,
   but it is the first time the CLI talks to the authenticated API rather than
   running checks locally, which is a bigger conceptual step than it looks.
6. **Existing tenants and `email`** — backfill yours by hand, or leave null? Null
   means the recovery path does not work for accounts created before this.
