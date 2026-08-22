import { defineConfig } from "vitest/config";

const projects = [
  {
    extends: true,
    test: {
      exclude: ["src/**/*.fixture.spec.ts"],
      include: ["src/**/*.spec.ts"],
      name: "cli",
    },
  },
];

if (process.env.PROPGATE_FIXTURES === "1") {
  projects.push({
    extends: true,
    test: {
      globalSetup: ["../dns/src/test/global-setup.ts"],
      include: ["src/**/*.fixture.spec.ts"],
      name: "cli-fixtures",
    },
  } as (typeof projects)[number]);
}

export default defineConfig({ test: { projects } });
