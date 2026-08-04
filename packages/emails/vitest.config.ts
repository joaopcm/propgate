import { defineConfig } from "vitest/config";

/**
 * One project. Composing a message is pure, and the only impure part — the send —
 * is behind an interface with a recording implementation.
 */
export default defineConfig({
  test: { include: ["src/**/*.spec.ts"], name: "emails" },
});
