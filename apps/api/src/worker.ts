import "./instrument";
import { workbench } from "@getworkbench/hono";
import { serve } from "@hono/node-server";
import { allQueues } from "@propgate/jobs";
import { Hono } from "hono";
import { env } from "./env";

/**
 * The background process. Same image as the API, different command.
 *
 * Two containers rather than one PID, and the reason is not scale: a sweep of a
 * hundred domains and an interactive `/v1/checks` would otherwise compete for
 * one event loop, and the customer-facing request is the one that loses. It also
 * means the worker can be restarted, or stopped entirely, without taking the API
 * with it.
 *
 * Invariant 4 is satisfied either way — this is a long-running process talking
 * to a Redis on the same box, not a per-invocation anything. What that invariant
 * forbids is billing per tick, which is why the Redis is one we run and never
 * Upstash.
 *
 * No processors yet. This phase brings up Redis, the queue vocabulary and the
 * dashboard; the sweeper's `Worker` instances land next, and putting them here
 * before the queues can be observed would mean debugging both at once.
 */

const queues = allQueues({ url: env.REDIS_URL });

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
    workbench({ auth: { password, username }, queues, title: "propgate jobs" })
  );

  return true;
}

const workbenchEnabled = mountWorkbench();

const server = serve({ fetch: app.fetch, port: env.WORKBENCH_PORT }, (info) => {
  process.stdout.write(
    `propgate worker listening on port ${info.port} (workbench ${
      workbenchEnabled ? "enabled" : "disabled — set WORKBENCH_USER/PASS"
    })\n`
  );
});

/**
 * Close the queues, not just the listener.
 *
 * Each queue holds a Redis connection, and a process that exits without closing
 * them leaves BullMQ's blocking clients to time out on the server side. Harmless
 * once; noticeable across a few hundred deploys.
 */
function shutdown(): void {
  server.close(() => {
    Promise.all(queues.map((queue) => queue.close()))
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
