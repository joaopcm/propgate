import "./instrument";
import { serve } from "@hono/node-server";
import { createDb } from "@propgate/db";
import { createContactList, createMailer } from "@propgate/emails";
import { createQueues } from "@propgate/jobs";
import { createApp } from "./app";
import { env } from "./env";
import { vantagePoints } from "./utils/vantage-points";

const resolver = { address: env.RESOLVER_ADDRESS, port: env.RESOLVER_PORT };

const queues = createQueues({ url: env.REDIS_URL });

const app = createApp({
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

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
