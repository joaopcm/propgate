import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Root convenience runner for unit specs, mainly for IDE integration and
 * `vitest --ui`.
 *
 * **`pnpm test` (turbo, per-package) is the real entry point.** Only the
 * per-package configs know about the fixture gating and the globalSetup that
 * checks the DNS tier is up and fresh.
 *
 * This does NOT enumerate the packages via `projects: ["packages/*"]`, which was
 * the obvious first attempt and is quietly wrong: Vitest does not support nested
 * projects, so `packages/dns`'s own two-project split (unit vs fixture-backed)
 * is flattened away. The result was that a root `vitest` run collected
 * `*.fixture.spec.ts` with no globalSetup and reported six raw ECONNREFUSED
 * failures — precisely the confusing outcome the readiness check exists to
 * prevent.
 *
 * So the fixture and serial patterns are excluded here outright. They cannot be
 * run from the root, by construction.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/*.fixture.spec.ts",
      "**/*.serial.spec.ts",
    ],
    include: [
      "apps/*/src/**/*.spec.{ts,tsx}",
      "packages/*/src/**/*.spec.{ts,tsx}",
    ],
    name: "unit",
  },
});
