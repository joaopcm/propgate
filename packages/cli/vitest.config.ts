import { defineConfig } from "vitest/config";

/**
 * Split the same way `packages/dns` and `apps/api` are.
 *
 * `cli` — argument parsing and output formatting, both pure.
 *
 * `cli-fixtures` — `main()` end to end against the live tier, which is the only
 * place the wiring between arguments, the engine, the report and the exit code
 * is actually exercised. Gated on PROPGATE_FIXTURES rather than reachability: a
 * suite that skips when the servers are down looks exactly like one that passed.
 */
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
