import "./instrument";
import { serve } from "@hono/node-server";
import { createDb } from "@propgate/db";
import { createContactList, createMailer } from "@propgate/emails";
import { createQueues } from "@propgate/jobs";
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

const queues = createQueues({ url: env.REDIS_URL });

const app = createApp({
  // Unset means confirmed signups go on no list at all, and signup still works.
  // See the option's note in `app.ts` for why this is not defaulted.
  ...(env.RESEND_SEGMENT_ID === undefined
    ? {}
    : {
        contacts: createContactList({
          apiKey: env.RESEND_API_KEY,
          segmentId: env.RESEND_SEGMENT_ID,
        }),
      }),
  db: createDb(env.DATABASE_URL),
  mailer: createMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }),
  resolver,
  resolvers: vantagePoints(env, resolver),
  thresholds: {
    degradedAfter: env.DEGRADED_AFTER_FAILURES,
    failedAfter: env.FAILED_AFTER_FAILURES,
  },
  webhooks: queues.deliverWebhook,
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
