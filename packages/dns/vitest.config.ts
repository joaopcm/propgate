import { defineConfig } from "vitest/config";

/**
 * Two projects, split by what they need rather than by what they cover.
 *
 * `dns` — static and unit specs. No containers, runs anywhere, always included.
 *
 * `dns-fixtures` — specs that query the live fixture tier. Included only when
 * PROPGATE_FIXTURES=1, which CI sets after `docker compose up -d --wait`. Gating
 * on an env var rather than on reachability is deliberate: a suite that silently
 * skips when the servers are down is worse than one that fails, because the
 * skip looks like a pass. When the flag is set and the tier is missing,
 * globalSetup throws with instructions.
 *
 * fileParallelism stays ON here, which differs from buckt's Postgres-driven
 * `fileParallelism: false`. The fixture zones are read-only and stateless, so
 * there is nothing to contend over. The exceptions are specs that mutate zones
 * or depend on Unbound's cache state; those belong in a *.serial.spec.ts file
 * and get their own project. Do not cargo-cult the Postgres setting here.
 */
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
