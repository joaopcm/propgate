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

## Why this split

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
docker compose -f docker-compose.prod.yml up -d --wait
```

Only ports 80 and 443 are published. Postgres and Unbound are reachable on the
compose network and nowhere else, and Unbound additionally refuses anything
outside it — an open recursive resolver on a public IP is a DNS amplification
weapon, and one lock on that door is not enough.

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

| Name | Type | Value |
|---|---|---|
| `propgate.dev` | Worker route | `propgate-web` |
| `docs` | Worker route | `propgate-docs` |
| `api` | `A` | the VPS address |

Leave `api` **unproxied** if you want Caddy to hold the certificate. Proxying it
through Cloudflare works too, but then two things issue certificates for one
name and only one of them is in this repository.

## Deploying

Both workflows run on push to `main`, scoped by path, and can be dispatched by
hand.

- `deploy-static.yml` builds and `wrangler deploy`s each app.
- `deploy-api.yml` pushes `api` and `unbound` images to GHCR tagged with the
  commit sha and `latest`, then `pull && up -d --wait` over SSH, then polls
  `/health` until it answers or the deploy fails.

Migrations run as a one-shot container that must exit successfully before the
API starts. Not at boot: boot migrations turn a bad migration into a crash loop
rather than a failed deploy, and become a race the moment there are two
replicas.

### Rolling back

Images are tagged by commit, so:

```sh
TAG=<previous-sha> docker compose -f docker-compose.prod.yml up -d --wait
```

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

It prints the key once. Only the hash is stored, so losing it means minting
another.

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
