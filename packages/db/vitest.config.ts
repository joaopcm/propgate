import { defineConfig } from "vitest/config";
import { testDatabaseUrl } from "./src/test/database-url";

const DATABASE_URL = testDatabaseUrl("db");

if (DATABASE_URL !== "") {
  process.env.DATABASE_URL = DATABASE_URL;
}

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
      env: { DATABASE_URL },
      fileParallelism: false,
      globalSetup: ["./src/test/global-setup.ts"],
      include: ["src/**/*.db.spec.ts"],
      name: "db-postgres",
    },
  } as (typeof projects)[number]);
}

export default defineConfig({ test: { projects } });
