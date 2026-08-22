FROM node:24-alpine AS builder

RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY turbo.json tsconfig.json ./

COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/docs/package.json apps/docs/
COPY apps/learn/package.json apps/learn/
COPY packages/dns/package.json packages/dns/
COPY packages/dns-fixtures/package.json packages/dns-fixtures/
COPY packages/db/package.json packages/db/
COPY packages/jobs/package.json packages/jobs/
COPY packages/emails/package.json packages/emails/
COPY packages/webhooks/package.json packages/webhooks/
COPY packages/cli/package.json packages/cli/
COPY packages/sdk/package.json packages/sdk/

RUN pnpm install --frozen-lockfile --filter @propgate/api...

COPY apps/api apps/api
COPY packages/dns packages/dns
COPY packages/db packages/db
COPY packages/jobs packages/jobs
COPY packages/emails packages/emails
COPY packages/webhooks packages/webhooks
RUN pnpm --filter @propgate/api build

RUN pnpm --filter @propgate/api deploy --prod --legacy /deploy

FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /deploy/node_modules ./node_modules
COPY --from=builder /repo/apps/api/dist ./dist
COPY --from=builder /repo/packages/db/drizzle ./drizzle

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

USER node
CMD ["node", "dist/index.js"]
