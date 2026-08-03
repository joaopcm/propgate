import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // jsdom for the whole project rather than a second one: the checker is a
    // client component, and the only interesting question about it is what a
    // browser ends up showing.
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    name: "web",
  },
});
