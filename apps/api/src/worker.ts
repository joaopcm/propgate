import "./instrument";
import { workbench } from "@getworkbench/hono";
import { serve } from "@hono/node-server";
import { createDb } from "@propgate/db";
import type {
  CheckDomainPayload,
  DeliverWebhookPayload,
  SweepTickPayload,
} from "@propgate/jobs";
import {
  connectionFor,
  createQueues,
  QUEUE_NAMES,
  queueList,
} from "@propgate/jobs";
import { Worker } from "bullmq";
import { Hono } from "hono";
import { env } from "./env";
import { checkClaimedDomain } from "./sweep/check-domain";
import type { TickDeps } from "./sweep/tick";
import { runReconcile, runTick } from "./sweep/tick";
import { vantagePoints } from "./utils/vantage-points";
import { attemptDelivery } from "./webhooks/deliver";
import { enqueueForTransition } from "./webhooks/enqueue";
import { runDeliveryReconcile } from "./webhooks/reconcile";

const db = createDb(env.DATABASE_URL);
const queues = createQueues({ url: env.REDIS_URL });
const connection = connectionFor(env.REDIS_URL);

const tickDeps: TickDeps = {
  batchSize: env.SWEEP_BATCH_SIZE,
  db,
  leaseSeconds: env.SWEEP_LEASE_SECONDS,
  queue: queues.checkDomain,
};

const thresholds = {
  degradedAfter: env.DEGRADED_AFTER_FAILURES,
  failedAfter: env.FAILED_AFTER_FAILURES,
};

const resolvers = vantagePoints(env, {
  address: env.RESOLVER_ADDRESS,
  port: env.RESOLVER_PORT,
});

const sweepWorker = new Worker<SweepTickPayload>(
  QUEUE_NAMES.sweep,
  async (job) => {
    if (job.data.reason === "reconcile-deliveries") {
      const requeued = await runDeliveryReconcile({
        attempts: env.WEBHOOK_ATTEMPTS,
        batchSize: env.SWEEP_BATCH_SIZE,
        db,
        queue: queues.deliverWebhook,
        timeoutMs: env.WEBHOOK_TIMEOUT_MS,
      });

      return { requeued };
    }

    const claimed =
      job.data.reason === "reconcile"
        ? await runReconcile(tickDeps)
        : await runTick(tickDeps);

    return { claimed };
  },
  { concurrency: 1, connection }
);

const checkWorker = new Worker<CheckDomainPayload>(
  QUEUE_NAMES.checkDomain,
  async (job) => {
    const outcome = await checkClaimedDomain(
      { db, settings: { resolvers, thresholds } },
      job.data
    );

    if (outcome.kind === "profile-missing") {
      throw new Error(
        `domain ${job.data.domainId} is pinned to profile version ${outcome.profileVersionId}, which no longer exists`
      );
    }

    if (outcome.kind === "gone") {
      return { state: "gone" };
    }

    if (outcome.kind === "superseded") {
      return { state: "superseded" };
    }

    const { transition } = outcome.checked;

    if (transition !== null) {
      await enqueueForTransition(
        { db, queue: queues.deliverWebhook },
        {
          domain: outcome.domain.name,
          domainId: job.data.domainId,
          externalId: outcome.domain.externalId,
          from: transition.from,
          reason: transition.reason,
          tenantId: job.data.tenantId,
          to: transition.to,
        }
      );
    }

    return { state: outcome.checked.state };
  },
  { concurrency: env.CHECK_CONCURRENCY, connection }
);

const deliveryWorker = new Worker<DeliverWebhookPayload>(
  QUEUE_NAMES.deliverWebhook,
  async (job) => {
    const result = await attemptDelivery(
      { db, timeoutMs: env.WEBHOOK_TIMEOUT_MS },
      job.data,
      { allowed: env.WEBHOOK_ATTEMPTS, made: job.attemptsMade + 1 }
    );

    if (result.kind === "retry") {
      throw new Error(result.error);
    }

    return { kind: result.kind };
  },
  {
    concurrency: env.CHECK_CONCURRENCY,
    connection,
    settings: { backoffStrategy: (attempts) => 1000 * 2 ** (attempts - 1) },
  }
);

await queues.sweep.upsertJobScheduler(
  "sweep-tick",
  { every: env.SWEEP_TICK_SECONDS * 1000 },
  { data: { reason: "tick" }, name: "tick" }
);

await queues.sweep.upsertJobScheduler(
  "sweep-reconcile",
  { every: env.SWEEP_TICK_SECONDS * 5000 },
  { data: { reason: "reconcile" }, name: "reconcile" }
);

await queues.sweep.upsertJobScheduler(
  "sweep-reconcile-deliveries",
  { every: env.SWEEP_TICK_SECONDS * 5000 },
  { data: { reason: "reconcile-deliveries" }, name: "reconcile-deliveries" }
);

const app = new Hono();

app.get("/health", (context) => context.json({ status: "ok" }));

function mountWorkbench(): boolean {
  const { WORKBENCH_PASS: password, WORKBENCH_USER: username } = env;

  if (username === undefined || password === undefined) {
    return false;
  }

  app.route(
    "/",
    workbench({
      auth: { password, username },
      queues: queueList(queues),
      title: "propgate jobs",
    })
  );

  return true;
}

const workbenchEnabled = mountWorkbench();

const server = serve({ fetch: app.fetch, port: env.WORKBENCH_PORT }, (info) => {
  process.stdout.write(
    `propgate worker listening on port ${info.port} (workbench ${
      workbenchEnabled ? "enabled" : "disabled — set WORKBENCH_USER/PASS"
    }, sweep every ${env.SWEEP_TICK_SECONDS}s, ${env.CHECK_CONCURRENCY} checks at a time, ${resolvers.length} vantage point${resolvers.length === 1 ? "" : "s"})\n`
  );
});

function shutdown(): void {
  server.close(() => {
    Promise.all([
      sweepWorker.close(),
      checkWorker.close(),
      deliveryWorker.close(),
    ])
      .then(() => Promise.all(queueList(queues).map((queue) => queue.close())))
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
