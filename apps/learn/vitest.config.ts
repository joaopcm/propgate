import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Node by default, matching apps/docs: most specs here read the curriculum
    // against the filesystem or check a registry-derived question, and paying
    // for a jsdom per file to do that is waste. The specs that need a DOM ask
    // for one with a `@vitest-environment` docblock of their own.
    include: ["src/**/*.spec.{ts,tsx}"],
    name: "learn",
  },
});
