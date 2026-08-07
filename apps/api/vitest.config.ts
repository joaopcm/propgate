import { testDatabaseUrl } from "@propgate/db/src/test/database-url";
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
 *
 * `api-integration` — the check route, which needs both tiers at once and is
 * the only thing in the repo that does. A project rather than a flag on one of
 * the others, so that running with just one tier up cannot silently skip it.
 */
/**
 * A database of this app's own. See `packages/db/src/test/database-url.ts`:
 * sharing one with `packages/db` means each truncating the other's rows while
 * turbo runs both packages at once.
 */
const DATABASE_URL = testDatabaseUrl("api");

if (DATABASE_URL !== "") {
  process.env.DATABASE_URL = DATABASE_URL;
}

const projects = [
  {
    extends: true,
    test: {
      /**
       * Every gated pattern, and forgetting one is not a quiet mistake.
       *
       * `include` is `*.spec.ts`, which matches all of them — so a pattern
       * missing here is collected by the project that runs with no containers.
       * It fails at *module load*, where the failure is a raw ECONNREFUSED on
       * whichever default port the client picked and names nothing that would
       * tell you a gate is wrong. `*.e2e.spec.ts` was added to this list one CI
       * run late, and only because the CI machine had no Postgres on 5432 to
       * hide it: a developer with one running sees the ungated project connect
       * and pass.
       */
      exclude: [
        "src/**/*.fixture.spec.ts",
        "src/**/*.db.spec.ts",
        "src/**/*.integration.spec.ts",
        "src/**/*.e2e.spec.ts",
      ],
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
      // The db package's own setup, by path, the same way `api-fixtures` points
      // at the DNS one. It knows where the migrations live; nothing here should
      // hold a second copy of that answer.
      env: { DATABASE_URL },
      fileParallelism: false,
      globalSetup: ["../../packages/db/src/test/global-setup.ts"],
      include: ["src/**/*.db.spec.ts"],
      name: "api-postgres",
    },
  } as (typeof projects)[number]);
}

// All three tiers. `sweep.integration.spec.ts` needs Redis as well as DNS and
// Postgres — it is the only spec that exercises claim, enqueue, check and
// reschedule together, which is the whole point of the sweeper.
if (
  process.env.PROPGATE_FIXTURES === "1" &&
  process.env.PROPGATE_DATABASE === "1" &&
  process.env.PROPGATE_REDIS === "1"
) {
  projects.push({
    extends: true,
    test: {
      env: { DATABASE_URL },
      fileParallelism: false,
      globalSetup: [
        "../../packages/dns/src/test/global-setup.ts",
        "../../packages/db/src/test/global-setup.ts",
      ],
      include: ["src/**/*.integration.spec.ts"],
      name: "api-integration",
    },
  } as (typeof projects)[number]);

  /**
   * `api-e2e` — the CLI against this API, over a socket.
   *
   * Its own project rather than another `*.integration.spec.ts` because what it
   * covers is different in kind: the integration specs call `app.request`, so
   * they can never catch a response shape the CLI reads differently than the API
   * writes it. This one drives `main()` from `@propgate/cli`, which is the only
   * place those two beliefs are compared.
   *
   * `fileParallelism` off for the same reason as `api-postgres` — it truncates —
   * and `testTimeout` raised because one test performs five real DNS check runs
   * across two vantage points and waits for four queued deliveries.
   */
  projects.push({
    extends: true,
    test: {
      env: { DATABASE_URL },
      fileParallelism: false,
      globalSetup: [
        "../../packages/dns/src/test/global-setup.ts",
        "../../packages/db/src/test/global-setup.ts",
      ],
      include: ["src/**/*.e2e.spec.ts"],
      name: "api-e2e",
      testTimeout: 60_000,
    },
  } as (typeof projects)[number]);
}

export default defineConfig({ test: { projects } });
