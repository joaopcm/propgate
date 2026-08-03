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
      exclude: [
        "src/**/*.fixture.spec.ts",
        "src/**/*.db.spec.ts",
        "src/**/*.integration.spec.ts",
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
}

export default defineConfig({ test: { projects } });
