import { defineConfig } from "vitest/config";

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
