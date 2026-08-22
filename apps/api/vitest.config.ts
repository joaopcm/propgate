import { testDatabaseUrl } from "@propgate/db/src/test/database-url";
import { defineConfig } from "vitest/config";

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
      env: { DATABASE_URL },
      fileParallelism: false,
      globalSetup: ["../../packages/db/src/test/global-setup.ts"],
      include: ["src/**/*.db.spec.ts"],
      name: "api-postgres",
    },
  } as (typeof projects)[number]);
}

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
