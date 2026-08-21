import createMDX from "@next/mdx";
import type { NextConfig } from "next";

// Plugins are given as string tuples rather than imported functions: Turbopack
// needs them serializable.
const withMDX = createMDX({
  options: {
    rehypePlugins: [["@shikijs/rehype", { theme: "github-dark-dimmed" }]],
    remarkPlugins: [["remark-gfm"]],
  },
});

const nextConfig: NextConfig = {
  // A static export, like apps/docs and apps/web. Every route here prerenders.
  //
  // The reader's progress is the only state this app has, and it lives in their
  // browser rather than in an account — so there is nothing for a server to do,
  // and no session for one to hold. That is a deliberate property rather than a
  // limitation to work around: a course that required signing up would be a
  // course fewer people finish.
  //
  // The tripwire is the same as the docs': `export` rules out request-time
  // rendering. The day progress needs to follow somebody between devices, this
  // becomes an OpenNext deployment with an account behind it, and that should be
  // a decision rather than a discovery.
  output: "export",
  pageExtensions: ["ts", "tsx", "mdx"],
  // Workspace packages ship raw TypeScript (main/types point at ./src), so Next
  // has to compile them rather than treat them as prebuilt deps. Both are here
  // because the quiz questions are generated from their registries at build
  // time — see src/lib/quiz/derived.ts.
  transpilePackages: ["@propgate/dns", "@propgate/dns-fixtures"],
};

export default withMDX(nextConfig);
