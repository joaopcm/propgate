# Deploying

Three surfaces, two places.

```
                    Cloudflare Workers (static assets)
                    ┌──────────────────┬──────────────────┐
    propgate.dev ──▶│ apps/web         │ apps/docs        │──▶ docs.propgate.dev
                    └────────┬─────────┴──────────────────┘
                             │ fetch /v1/checks
                             ▼
                    ┌─────────────────────────────────────┐
    api.propgate.dev│ caddy ──▶ api ──▶ postgres          │  one VPS
                    │            └────▶ unbound ──▶ 🌐    │
                    └─────────────────────────────────────┘
```

Everything below is in the repository. There is no console-only configuration
except the secrets, which is the point: a deployment nobody can read is a
deployment nobody can fix at 2am.

## The proxy is not part of the application

`docker-compose.prod.yml` is the stack — Postgres, Unbound, the migration step
and the API — and **it publishes no ports**. Getting requests from the internet
to the API belongs to the environment, and environments disagree about how:

| Where | What to run |
|---|---|
| A bare VPS | `-f docker-compose.prod.yml -f docker-compose.caddy.yml` — the overlay adds Caddy, which gets a certificate and renews it |
| Coolify, Dokploy, CapRover, Kamal, a Kubernetes ingress | `docker-compose.prod.yml` alone. They already run a proxy; a second one binding `:443` collides with it, and their routing is the one their dashboard knows about |

That split is not a courtesy to any particular platform. A compose file which
assumes it owns port 443 only runs where nothing else does, and this is an
open-source project people will deploy in places we have never seen.

Two consequences worth knowing:

- **`API_DOMAIN` only matters with the Caddy overlay.** It is the name Caddy
  requests a certificate for. Elsewhere, the platform holds the hostname.
- **The SSH deploy job is opt-in.** Set the `DEPLOY_TARGET` repository variable
  to `ssh` for a bare VPS. Leave it unset and the job does not run — the images
  are still built and pushed, and whatever watches the registry or the
  repository takes it from there.

## Why the surfaces live where they do

**Web and docs are static.** Neither has a route handler, a server action, or a
page that renders at request time — the public checker is a client component
calling the API from the browser. `output: "export"` produces plain files, so
they need no adapter, no Node runtime at the edge, and no cold start. The
tripwire is written into both `next.config.ts`: the day something needs a server,
that becomes an `@opennextjs/cloudflare` deployment, and it should be a decision
rather than a discovery.

**The API is on a box we control**, for one reason above all others: the
delegation evaluator queries each authoritative nameserver directly over UDP and
TCP on port 53. Managed platforms frequently restrict or NAT that, and when it is
flaky it surfaces as `indeterminate` verdicts that look like a customer's DNS
being broken. We also run our own validating resolver rather than pointing at
`1.1.1.1`, because an answer out of someone else's cache is an answer we cannot
explain — and explaining answers is the product.

## One-time setup

### The box

Any VPS with Docker. Give it a DNS record first — Let's Encrypt validates over
HTTP, so a missing `A` record is a failed deploy rather than a slow one.

```sh
git clone https://github.com/joaopcm/propgate.git /srv/propgate
cd /srv/propgate
cp .env.production.example .env
$EDITOR .env                      # POSTGRES_PASSWORD, API_DOMAIN
docker compose -f docker-compose.prod.yml -f docker-compose.caddy.yml up -d --wait
```

The first bring-up **builds** the images from the checkout, which is why both
services carry a `build:` alongside their `image:`. That breaks the chicken and
egg: the registry has nothing until a deploy runs, and a deploy needs a box that
already works. Afterwards the workflow sets `TAG` and pulls instead.

Only ports 80 and 443 are published. Postgres and Unbound are reachable on the
compose network and nowhere else, and Unbound additionally refuses anything
outside it — an open recursive resolver on a public IP is a DNS amplification
weapon, and one lock on that door is not enough.

### Pulling from the registry

GHCR packages are private by default, so the box cannot pull until one of:

- **Make the two packages public** (`ghcr.io/joaopcm/propgate/api` and
  `/unbound`, under the repository's *Packages* settings). Reasonable here — the
  source is already public, and it removes a credential from the box.
- **Log in on the box** with a personal access token scoped to `read:packages`:
  ```sh
  echo "$GHCR_TOKEN" | docker login ghcr.io -u joaopcm --password-stdin
  ```

Skip this and the first real deploy fails at `docker compose pull` with
`denied`, which reads like a missing image rather than a missing credential.

### GitHub

`Settings → Secrets and variables → Actions`:

| Secret | For |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers deploys. Scope it to *Edit Cloudflare Workers* |
| `CLOUDFLARE_ACCOUNT_ID` | Same |
| `DEPLOY_HOST` `DEPLOY_USER` `DEPLOY_SSH_KEY` `DEPLOY_PATH` | The VPS. On the `production` environment, not the repository, so every workflow cannot read them |

Variables (optional, defaults in the workflows): `NEXT_PUBLIC_API_URL`,
`NEXT_PUBLIC_DOCS_URL`, `API_DOMAIN`.

### DNS

| Name | Who creates it |
|---|---|
| `propgate.dev` | Cloudflare, from `apps/web/wrangler.jsonc` |
| `docs.propgate.dev` | Cloudflare, from `apps/docs/wrangler.jsonc` |
| `api.propgate.dev` | **You**, an `A` record to the VPS, before the first deploy |

The two Worker hostnames are declared as `custom_domain` routes, so Cloudflare
creates and maintains those records itself — the only place either hostname is
written down is the repository. That also means the zone must already be on
Cloudflare; if it is not, the deploy fails loudly rather than quietly publishing
to a `workers.dev` URL nobody is looking at.

`api` is yours to create, and leave it **unproxied** if you want Caddy to hold
the certificate. Proxying it through Cloudflare works too, but then two things
issue certificates for one name and only one of them is in this repository.

## Deploying

Both workflows run on push to `main`, scoped by path, and can be dispatched by
hand.

- `deploy-static.yml` builds and `wrangler deploy`s each app.
- `deploy-api.yml` pushes `api` and `unbound` images to GHCR tagged with the
  commit sha and `latest`. If `DEPLOY_TARGET` is `ssh` it then runs
  `pull && up -d --wait` on the box and polls `/health` until it answers or the
  deploy fails; otherwise it stops after the push and leaves shipping to
  whatever is watching.

Migrations run as a one-shot container that must exit successfully before the
API starts. Not at boot: boot migrations turn a bad migration into a crash loop
rather than a failed deploy, and become a race the moment there are two
replicas.

### Rolling back

Images are tagged by commit, so:

```sh
TAG=<previous-sha> docker compose -f docker-compose.prod.yml \
  -f docker-compose.caddy.yml up -d --wait
```

On a platform that deploys for you, roll back to the previous image tag its way.

Migrations do not roll back. A change that cannot be applied twice, or that an
older image cannot read, needs to be split into two deploys — expand first, then
contract.

## Onboarding a tenant

There is no signup and no admin API, both deliberately. Keys are minted on the
box:

```sh
docker compose -f docker-compose.prod.yml run --rm api \
  node dist/mint.js "Partner name" "production"
```

On a platform with a terminal, the same thing is
`node dist/mint.js "Partner name" "production"` inside the API container.

It prints the key once. Only the hash is stored, so losing it means minting
another.

### Taking a key away

```sh
docker compose -f docker-compose.prod.yml run --rm api node dist/keys.js list
docker compose -f docker-compose.prod.yml run --rm api \
  node dist/keys.js revoke pg_live_Ab3x
```

Revoke by the prefix, which is the part of a key still readable after it was
issued. It takes effect on the next request — `bearerAuth` reads `revoked_at` on
every lookup, so there is no cache to wait out — and the caller gets
`401 this API key has been revoked`, told apart from `invalid API key` so they
know it is not a typo.

Two refusals, both deliberate, both exiting non-zero so a script notices:

- **A prefix matching more than one key.** Four base64url characters carry no
  unique index, so a collision is unlikely and not impossible. It lists the
  candidates and asks for an id instead of guessing which partner to cut off.
- **The last active key for a tenant.** There is no un-revoke; recovering means
  minting a new key and getting it to them. `--force` when that is the intent.

Deliberately not an API route. A key that can revoke keys is a
privilege-escalation question, and the control plane is out of scope — but
handing an operator raw `UPDATE` statements against the auth table is how
someone eventually forgets a `WHERE` clause under pressure.

## Looking at the database

`psql` needs nothing:

```sh
tailscale ssh vps
docker compose -f docker-compose.prod.yml exec postgres psql -U propgate -d propgate
```

A GUI client or `drizzle-kit studio` needs a TCP socket. Postgres is bound to
`DB_BIND_ADDRESS`, which defaults to `127.0.0.1` — reachable from the machine
itself and nowhere else. Then either:

**Tunnel over Tailscale.** Nothing listens outside the machine.

```sh
ssh -L 5432:127.0.0.1:5432 you@vps       # Tailscale SSH works fine here
# GUI → localhost:5432, user propgate, database propgate
```

**Or bind to the tailnet** and skip the tunnel:

```sh
tailscale ip -4                          # 100.x.y.z
# .env: DB_BIND_ADDRESS=100.x.y.z
# GUI → 100.x.y.z:5432
```

Every device on your tailnet can then reach Postgres, so this trades a tunnel
for trusting your tailnet ACLs — a real trade, worth making deliberately.

If something already owns 5432 on the box — common wherever a PaaS is running —
set `DB_BIND_PORT` to anything free. The container still listens on 5432
internally and nothing else in the stack notices, including the API, which
reaches Postgres over the compose network rather than the host.

> **Never set `DB_BIND_ADDRESS=0.0.0.0`.** That publishes Postgres to the
> internet, where it will be found: scanners sweep 5432 continuously. The only
> thing between a stranger and every tenant's data would be
> `POSTGRES_PASSWORD`. The variable names a bind address rather than taking a
> boolean so that this has to be typed out on purpose.

This is in `docker-compose.prod.yml` rather than an overlay on purpose. Every
operator eventually needs to look at the data, and platforms that deploy from
git — Coolify among them — read one compose file and cannot be handed a second
with `-f`. A default that forces those users to fork the file, or to edit it in
a dashboard where the change does not travel with the next deploy, is a worse
answer than binding to loopback.

If you would rather publish nothing at all, delete the `ports:` block. Nothing
else depends on it: the API talks to Postgres over the compose network, and
`docker compose exec postgres psql` needs no published port either.

## Backups

`postgres-data` is a Docker volume on one machine, which is not a backup.

```sh
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U propgate propgate | gzip > propgate-$(date +%F).sql.gz
```

Put that on a cron and ship it off the box. Restore by piping it back through
`psql` into an empty database — and confirm that works before you need it,
because a backup nobody has restored is a hypothesis.

## Checking a deploy

```sh
curl -s https://api.propgate.dev/health

# The whole path, including our resolver.
curl -s -X POST https://api.propgate.dev/v1/checks \
  -H 'content-type: application/json' \
  -d '{"domain":"example.com","checks":["spf","dmarc"]}'

# Unbound, directly.
docker compose -f docker-compose.prod.yml exec unbound \
  dig @127.0.0.1 +dnssec example.com A
```

An `ad` flag on the last one means DNSSEC validation is working. Its absence on
a signed domain means the root trust anchor did not come down at image build
time, and every signed domain will be reported `indeterminate`.
