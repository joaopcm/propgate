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
 */
const projects = [
  {
    extends: true,
    test: {
      exclude: ["src/**/*.fixture.spec.ts"],
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

export default defineConfig({ test: { projects } });
