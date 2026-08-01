import { defineConfig } from "vitest/config";

/**
 * Split the same way `packages/dns` is, and for the same reason.
 *
 * `api` — route specs that never reach a lookup: validation, rate limiting,
 * the error envelope. No containers, always included.
 *
 * `api-fixtures` — the round trip against the live tier. Gated on
 * PROPGATE_FIXTURES rather than on reachability, because a suite that silently
 * skips when the servers are down looks exactly like a suite that passed.
 *
 * `api-postgres` — anything that authenticates or stores. Gated on
 * PROPGATE_DATABASE, and `fileParallelism` is off here for the same reason it
 * is off in `packages/db`: a shared Postgres is mutable state. The two projects
 * above keep parallelism on; DNS fixtures are read-only and nothing contends.
 */
const projects = [
  {
    extends: true,
    test: {
      exclude: ["src/**/*.fixture.spec.ts", "src/**/*.db.spec.ts"],
      include: ["src/**/*.spec.ts"],
      name: "api",
    },
  },
];

if (process.env.PROPGATE_FIXTURES === "1") {
  projects.push({
    extends: true,
    test: {
      globalSetup: ["../../packages/dns/src/test/global-setup.ts"],
      include: ["src/**/*.fixture.spec.ts"],
      name: "api-fixtures",
    },
  } as (typeof projects)[number]);
}

if (process.env.PROPGATE_DATABASE === "1") {
  projects.push({
    extends: true,
    test: {
      fileParallelism: false,
      // The db package's own setup, by path, the same way `api-fixtures` points
      // at the DNS one. It knows where the migrations live; nothing here should
      // hold a second copy of that answer.
      globalSetup: ["../../packages/db/src/test/global-setup.ts"],
      include: ["src/**/*.db.spec.ts"],
      name: "api-postgres",
    },
  } as (typeof projects)[number]);
}

export default defineConfig({ test: { projects } });
