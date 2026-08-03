import { defineConfig } from "vitest/config";

/**
 * Two projects, the same shape as `packages/dns` and `packages/db`.
 *
 * `jobs` — anything pure. Empty today; almost everything here is a queue
 * definition, and a queue definition is only meaningful against a server. The
 * package script passes with no tests for that reason, and the gated project
 * below has its own CI tripwire so this cannot hide a suite that stopped
 * running.
 *
 * `jobs-redis` — specs that touch a real Redis, gated on PROPGATE_REDIS.
 *
 * **`fileParallelism` stays on here**, unlike `db-postgres`. That setting exists
 * for shared mutable state, and BullMQ's key prefix removes the sharing instead
 * of serialising around it: every spec takes a unique prefix from
 * `testPrefix()`, so two files running at once cannot see each other's queues.
 * TESTING.md warns against copying `fileParallelism: false` into the DNS specs;
 * the warning points here too.
 */
const projects = [
  {
    extends: true,
    test: {
      exclude: ["src/**/*.queue.spec.ts"],
      include: ["src/**/*.spec.ts"],
      name: "jobs",
    },
  },
];

if (process.env.PROPGATE_REDIS === "1") {
  projects.push({
    extends: true,
    test: {
      globalSetup: ["./src/test/global-setup.ts"],
      include: ["src/**/*.queue.spec.ts"],
      name: "jobs-redis",
    },
  } as (typeof projects)[number]);
}

export default defineConfig({ test: { projects } });
