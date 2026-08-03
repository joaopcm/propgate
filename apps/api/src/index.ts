import "./instrument";
import { serve } from "@hono/node-server";
import { createDb } from "@propgate/db";
import { createApp } from "./app";
import { env } from "./env";
import { vantagePoints } from "./utils/vantage-points";

/**
 * The wired instance lives here rather than in `app.ts` so that importing the
 * factory does not read the environment. A spec that only wants the public
 * checker should not need a DATABASE_URL, and before this it did — every route
 * spec failed at import with "Invalid environment variables".
 */
const resolver = { address: env.RESOLVER_ADDRESS, port: env.RESOLVER_PORT };

const app = createApp({
  db: createDb(env.DATABASE_URL),
  resolver,
  resolvers: vantagePoints(env, resolver),
  thresholds: {
    degradedAfter: env.DEGRADED_AFTER_FAILURES,
    failedAfter: env.FAILED_AFTER_FAILURES,
  },
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  process.stdout.write(`propgate api listening on port ${info.port}\n`);
});

// This process is long-lived by design — the sweeper that arrives in Phase 2
// is a continuous loop, which is exactly what per-invocation billing is worst
// at. Shut down cleanly so in-flight lookups aren't cut off mid-query.
function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
