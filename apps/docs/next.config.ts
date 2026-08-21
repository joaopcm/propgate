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
  // prerenders, and so do the route handlers (`/search-index.json`,
  // `/openapi.json`, `/llms.txt`, `/v1/pages`, per-page `.md`): they are
  // `force-static`, so they run at build and land in `out/` as files.
  //
  // A small Worker (`src/worker.ts`) sits in front for Accept negotiation
  // and agent 404s. It does not render pages. An adapter such as
  // @opennextjs/cloudflare is still unnecessary — it exists for apps that
  // need a server at the edge, and this one still does not.
  //
  // The tripwire: `export` rules out ISR and request-time rendering. The day a
  // dashboard needs server-side auth, this becomes an OpenNext deployment, and
  // that should be a decision rather than a discovery.
  output: "export",
  pageExtensions: ["ts", "tsx", "mdx"],
  // Workspace packages ship raw TypeScript (main/types point at ./src), so Next
  // has to compile them rather than treat them as prebuilt deps.
  transpilePackages: [
    "@propgate/dns",
    "@propgate/dns-fixtures",
    "@propgate/webhooks",
  ],
};

export default withMDX(nextConfig);
