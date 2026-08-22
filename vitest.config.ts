import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
