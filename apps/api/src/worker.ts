import "./instrument";
import { workbench } from "@getworkbench/hono";
import { serve } from "@hono/node-server";
import { createDb } from "@propgate/db";
import type { CheckDomainPayload, SweepTickPayload } from "@propgate/jobs";
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

/**
 * The background process. Same image as the API, different command.
 *
 * Two containers rather than one PID, and the reason is not scale: a sweep of a
 * hundred domains and an interactive `/v1/checks` would otherwise compete for one
 * event loop, and the customer-facing request is the one that loses. It also means
 * the worker can be restarted, or stopped entirely, without taking the API with
 * it.
 *
 * Invariant 4 is satisfied either way — this is a long-running process talking to
 * a Redis on the same box, not a per-invocation anything. What that invariant
 * forbids is billing per tick, which is why the Redis is one we run and never
 * Upstash.
 */

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

/**
 * The scheduler that claims work, and the one that recovers it.
 *
 * `upsertJobScheduler` is keyed by id, so a restart replaces the schedule rather
 * than adding a second one. Registering with `queue.add` and an interval would
 * accumulate a new repeating job on every deploy until the sweep ran once per
 * deploy per minute — a slow, invisible multiplication of load.
 */
const sweepWorker = new Worker<SweepTickPayload>(
  QUEUE_NAMES.sweep,
  async (job) => {
    const claimed =
      job.data.reason === "reconcile"
        ? await runReconcile(tickDeps)
        : await runTick(tickDeps);

    return { claimed };
  },
  // One at a time. Two concurrent ticks would be correct — `skip locked` makes
  // them take disjoint sets — but there is no reason to want them, and serial
  // ticks make the log readable.
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
      // Thrown rather than swallowed: the reference does not cascade, so this
      // cannot happen without something having gone wrong upstream, and the
      // failed job carries the ids needed to find out what.
      throw new Error(
        `domain ${job.data.domainId} is pinned to profile version ${outcome.profileVersionId}, which no longer exists`
      );
    }

    if (outcome.kind === "gone") {
      return { state: "gone" };
    }

    return { state: outcome.checked.state };
  },
  { concurrency: env.CHECK_CONCURRENCY, connection }
);

await queues.sweep.upsertJobScheduler(
  "sweep-tick",
  { every: env.SWEEP_TICK_SECONDS * 1000 },
  { data: { reason: "tick" }, name: "tick" }
);

/**
 * Five times the tick interval.
 *
 * The reconciler is a backstop for a Redis that lost its jobs, not a second
 * sweeper. Running it as often as the tick would double the claim queries to
 * catch a case that happens on the order of never; running it far less often
 * would leave a flushed Redis unmonitored for that long.
 */
await queues.sweep.upsertJobScheduler(
  "sweep-reconcile",
  { every: env.SWEEP_TICK_SECONDS * 5000 },
  { data: { reason: "reconcile" }, name: "reconcile" }
);

const app = new Hono();

// Registered before Workbench, which is mounted at the root. Hono matches in
// declaration order, so this stays reachable as the container's healthcheck
// regardless of what the dashboard does with `/`.
app.get("/health", (context) => context.json({ status: "ok" }));

/** Mounts the dashboard when it is configured. Returns whether it did. */
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

/**
 * Close the workers before the queues.
 *
 * A worker closed cleanly finishes the job it is holding and stops claiming new
 * ones, so an in-flight check completes and writes its `next_check_at` instead of
 * leaving the row to wait out its lease. Killing the process instead costs a
 * lease-length of delay on however many domains were in flight — recoverable, but
 * pointless when waiting is this cheap.
 */
function shutdown(): void {
  server.close(() => {
    Promise.all([sweepWorker.close(), checkWorker.close()])
      .then(() => Promise.all(queueList(queues).map((queue) => queue.close())))
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
