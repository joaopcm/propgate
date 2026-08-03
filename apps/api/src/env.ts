import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    /**
     * Required at boot, unlike the resolver's defaults.
     *
     * The authenticated routes are the product; starting without a database and
     * discovering it on the first request is the kind of failure that reaches a
     * partner before it reaches us.
     */
    DATABASE_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().default(3001),
    /**
     * Required at boot, for the same reason as DATABASE_URL.
     *
     * Required on the API too, not only the worker: the API enqueues webhook
     * deliveries, and the alternative is a process that starts fine and drops
     * every outbound event until somebody notices. Both run from one image with
     * one env schema, so splitting this into "required over there, optional
     * here" would buy a subtler failure and nothing else.
     */
    REDIS_URL: z.string().url(),
    /**
     * The recursive resolver every check queries.
     *
     * Port is explicit and never assumed to be 53: the fixture tier serves real
     * port 53 on distinct loopback addresses, and a production deployment may
     * run its own Unbound somewhere else entirely.
     */
    RESOLVER_ADDRESS: z.string().min(1).default("127.0.0.1"),
    RESOLVER_PORT: z.coerce.number().int().min(1).max(65_535).default(53),
    SENTRY_DSN: z.string().url().optional(),
    /**
     * Queue admin. Optional, and unset means not mounted at all.
     *
     * Workbench is pre-1.0, so the blast radius is worth bounding twice: it runs
     * in the worker rather than the API, and it only exists when someone has
     * typed credentials for it. A box that never looks at its queues runs
     * without it.
     */
    WORKBENCH_PASS: z.string().min(1).optional(),
    /**
     * Its own port on the worker, published to loopback or a tailnet address by
     * compose — the same shape as DB_BIND_ADDRESS. Never the API's port: queue
     * admin has no business sharing a listener with customer traffic.
     */
    WORKBENCH_PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
    WORKBENCH_USER: z.string().min(1).optional(),
  },
});
