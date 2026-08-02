import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entry: ["src/index.ts", "src/migrate.ts", "src/mint.ts"],
  format: ["esm"],
  noExternal: [/@propgate\/.*/],
  outDir: "dist",
});
