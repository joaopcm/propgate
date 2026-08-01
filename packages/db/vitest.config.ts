import { defineConfig } from "vitest/config";

/**
 * Two projects, split by what they need — the same shape as `packages/dns`.
 *
 * `db` — anything pure. Runs anywhere, and is empty today: almost everything
 * here is a schema, and a schema is only meaningful against a database. The
 * package script passes with no tests for that reason. The gated project below
 * has its own tripwire in CI, so this cannot hide a suite that stopped running.
 *
 * `db-postgres` — specs that touch a real database, gated on
 * PROPGATE_DATABASE. `fileParallelism` is OFF here and only here: a shared
 * Postgres is mutable state and parallel files trample each other. TESTING.md
 * warns against copying that setting into the DNS specs, where the fixtures are
 * read-only and nothing contends. The warning runs both ways.
 */
const projects = [
  {
    extends: true,
    test: {
      exclude: ["src/**/*.db.spec.ts"],
      include: ["src/**/*.spec.ts"],
      name: "db",
    },
  },
];

if (process.env.PROPGATE_DATABASE === "1") {
  projects.push({
    extends: true,
    test: {
      fileParallelism: false,
      globalSetup: ["./src/test/global-setup.ts"],
      include: ["src/**/*.db.spec.ts"],
      name: "db-postgres",
    },
  } as (typeof projects)[number]);
}

export default defineConfig({ test: { projects } });
