import { defineConfig } from "tsup";

/**
 * Dual format, the same as `@propgate/dns`.
 *
 * A backend calling this is as likely to be CommonJS as ESM, and shipping only
 * ESM means the `require()` half of Node has to transpile us or do without.
 *
 * `@propgate/dns` stays external and is a real dependency, unlike in the CLI
 * which bundles it. Everything taken from it is a *type* — the diagnosis
 * taxonomy, which is a public contract and must not be a copy that drifts — so
 * nothing of it is imported at runtime, while the emitted `.d.ts` refers to it
 * by name. Bundling would mean a consumer holding two copies of the taxonomy
 * that `instanceof` and type identity both fail to reconcile.
 */
export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  sourcemap: true,
});
