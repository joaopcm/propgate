# Production image for the always-on resolver service.
#
# Deployment is deliberately boring: build, push, then `docker compose pull &&
# docker compose up -d` over SSH on a single VPS. The process is long-lived by
# design — the sweeper is a continuous loop, which is the worst possible fit for
# per-invocation billing.
FROM node:24-alpine AS builder

RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY turbo.json tsconfig.json ./

# Every workspace manifest, not just the ones being built. packages/dns has a
# workspace devDependency on @propgate/dns-fixtures, and pnpm resolves the whole
# workspace graph even behind --filter, so a missing manifest fails the install.
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/docs/package.json apps/docs/
COPY packages/dns/package.json packages/dns/
COPY packages/dns-fixtures/package.json packages/dns-fixtures/
COPY packages/db/package.json packages/db/
COPY packages/jobs/package.json packages/jobs/
COPY packages/webhooks/package.json packages/webhooks/
COPY packages/cli/package.json packages/cli/

RUN pnpm install --frozen-lockfile --filter @propgate/api...

COPY apps/api apps/api
COPY packages/dns packages/dns
COPY packages/db packages/db
COPY packages/jobs packages/jobs
COPY packages/webhooks packages/webhooks
RUN pnpm --filter @propgate/api build

# The build bundles every @propgate/* package into its output but leaves real
# dependencies — hono, zod, postgres, drizzle-orm — as bare imports, so the
# runtime still needs a node_modules. `pnpm deploy` resolves that graph,
# including transitive dependencies reached only through the bundled workspace
# packages, into one self-contained directory.
# --legacy because the workspace does not use injected dependencies; pnpm 10
# requires the flag to say so explicitly.
RUN pnpm --filter @propgate/api deploy --prod --legacy /deploy

FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /deploy/node_modules ./node_modules
COPY --from=builder /repo/apps/api/dist ./dist
# The migration SQL, applied by a one-shot container before the API starts
# rather than at boot. See src/migrate.ts for why.
COPY --from=builder /repo/packages/db/drizzle ./drizzle

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

USER node
CMD ["node", "dist/index.js"]
