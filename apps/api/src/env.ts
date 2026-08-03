import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    /**
     * How many `check-domain` jobs run at once.
     *
     * **Unmeasured**, and the one most likely to be wrong. Each check is up to
     * ~20 upstream queries, so this multiplies straight into load on our Unbound
     * and on other people's authoritative servers. Four is deliberately timid.
     * The receipt: the point at which Unbound's response latency degrades under
     * parallel checks, measurable on the box in Phase 6.
     */
    CHECK_CONCURRENCY: z.coerce.number().int().min(1).default(4),
    /**
     * Required at boot, unlike the resolver's defaults.
     *
     * The authenticated routes are the product; starting without a database and
     * discovering it on the first request is the kind of failure that reaches a
     * partner before it reaches us.
     */
    DATABASE_URL: z.string().url(),
    /**
     * Consecutive failures before a domain is `degraded`, then `failed`.
     *
     * **Both unmeasured**, and tunable by env precisely because of that: the
     * first false alarm should cost a restart rather than a deploy. One and three
     * mean a warning on the first definite failure and a customer-visible failure
     * after roughly ten minutes of sustained failure at the degraded cadence —
     * long enough to outlast a resolver restart or a zone reload.
     *
     * The receipt both wait on: the observed distribution of consecutive
     * transient failures across real monitored domains over thirty days.
     * `state_transitions` is what makes that measurable after the fact.
     */
    DEGRADED_AFTER_FAILURES: z.coerce.number().int().min(1).default(1),
    FAILED_AFTER_FAILURES: z.coerce.number().int().min(1).default(3),
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
    /**
     * The vantage points for authenticated checks, as `address:port` entries
     * separated by commas. Unset means "just RESOLVER_ADDRESS", so nothing
     * already deployed changes behaviour.
     *
     * Production is our own Unbound plus two public resolvers. They share this
     * box's egress IP, so they are only weakly independent: they catch cache
     * state, propagation lag and one resolver being broken, and they cannot see
     * GeoDNS or a network path that differs by geography.
     */
    RESOLVER_ADDRESSES: z.string().optional(),
    RESOLVER_PORT: z.coerce.number().int().min(1).max(65_535).default(53),
    SENTRY_DSN: z.string().url().optional(),
    /**
     * How many domains one tick claims and hands to the queue.
     *
     * **Unmeasured.** A tripwire against a runaway sweep rather than a tuned
     * number: at 100 per tick and a 60-second tick the ceiling is 144,000 checks
     * a day, well past anything current. The receipt this waits on is one tick's
     * wall clock at the real domain count, taken in Phase 6.
     */
    SWEEP_BATCH_SIZE: z.coerce.number().int().min(1).default(100),
    /**
     * How long a claimed domain is not re-claimable.
     *
     * Must exceed the check budget (10s) by a wide margin or a slow-but-healthy
     * check gets claimed twice. Five minutes is that margin. Lowering it makes
     * crash recovery faster and double-checking more likely; there is no reason to
     * want the trade in that direction.
     */
    SWEEP_LEASE_SECONDS: z.coerce.number().int().min(1).default(300),
    /** How often the sweeper looks for due domains. */
    SWEEP_TICK_SECONDS: z.coerce.number().int().min(1).default(60),
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
