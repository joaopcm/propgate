import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@propgate/api-openapi": fileURLToPath(
        new URL("../api/src/openapi.ts", import.meta.url)
      ),
    },
  },
  test: {
    include: ["src/**/*.spec.{ts,tsx}"],
    name: "docs",
  },
});
