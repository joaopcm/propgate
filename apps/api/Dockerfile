# Production image for the always-on resolver service.
#
# Deployment is deliberately boring: build, push, then `docker compose pull &&
# docker compose up -d` over SSH on a single VPS. No Railway config in Phase 0 —
# that decision belongs with Phase 2, when Postgres, Redis, and the sweeper
# arrive and the process count stops being one.
FROM node:24-alpine AS builder

RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY turbo.json tsconfig.json ./

# Every workspace manifest, not just api's and dns's. packages/dns has a
# workspace devDependency on @propgate/dns-fixtures, and pnpm resolves the whole
# workspace graph even behind --filter, so a missing manifest fails the install.
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/docs/package.json apps/docs/
COPY packages/dns/package.json packages/dns/
COPY packages/dns-fixtures/package.json packages/dns-fixtures/
COPY packages/cli/package.json packages/cli/

RUN pnpm install --frozen-lockfile --filter @propgate/api...

COPY apps/api apps/api
COPY packages/dns packages/dns
RUN pnpm --filter @propgate/api build

FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /repo/apps/api/dist ./dist

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

USER node
CMD ["node", "dist/index.js"]
