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
  // A static export, deployed as assets on Cloudflare Workers. Every page here
  // prerenders, and so does the one route handler: `/search-index.json` is
  // `force-static`, so it runs at build and lands in `out/` as a file rather
  // than as anything that serves a request. There are no server actions, and
  // the public checker is a client component that calls the API from the
  // browser. That makes an adapter such as @opennextjs/cloudflare unnecessary —
  // it exists for apps that need a server at the edge, and this one does not.
  //
  // The tripwire: `export` rules out ISR and request-time rendering. The day a
  // dashboard needs server-side auth, this becomes an OpenNext deployment, and
  // that should be a decision rather than a discovery.
  output: "export",
  pageExtensions: ["ts", "tsx", "mdx"],
  // Workspace packages ship raw TypeScript (main/types point at ./src), so Next
  // has to compile them rather than treat them as prebuilt deps.
  transpilePackages: ["@propgate/dns", "@propgate/dns-fixtures"],
};

export default withMDX(nextConfig);
