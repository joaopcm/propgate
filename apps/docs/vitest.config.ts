import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // The project stays on the node environment: every other spec here reads
    // `page.mdx` files or the built stylesheet off disk, and paying for a jsdom
    // per file to do that is waste. The one component spec asks for jsdom with
    // a `@vitest-environment` docblock of its own.
    include: ["src/**/*.spec.{ts,tsx}"],
    name: "docs",
  },
});
