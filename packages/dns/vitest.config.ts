import { defineConfig } from "vitest/config";

const projects = [
  {
    extends: true,
    test: {
      exclude: ["src/**/*.fixture.spec.ts", "src/**/*.serial.spec.ts"],
      include: ["src/**/*.spec.ts"],
      name: "dns",
    },
  },
];

if (process.env.PROPGATE_FIXTURES === "1") {
  projects.push(
    {
      extends: true,
      test: {
        globalSetup: ["./src/test/global-setup.ts"],
        include: ["src/**/*.fixture.spec.ts"],
        name: "dns-fixtures",
      },
    },
    {
      extends: true,
      test: {
        fileParallelism: false,
        globalSetup: ["./src/test/global-setup.ts"],
        include: ["src/**/*.serial.spec.ts"],
        name: "dns-serial",
      },
    } as (typeof projects)[number]
  );
}

export default defineConfig({ test: { projects } });
