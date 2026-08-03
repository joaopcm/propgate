import { defineConfig } from "vitest/config";

/**
 * One project. Signing is pure — `node:crypto` and nothing else — so there is no
 * tier to bring up and no gate to forget.
 */
export default defineConfig({
  test: { include: ["src/**/*.spec.ts"], name: "webhooks" },
});
