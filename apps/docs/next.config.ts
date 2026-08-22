import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const withMDX = createMDX({
  options: {
    rehypePlugins: [["@shikijs/rehype", { theme: "github-dark-dimmed" }]],
    remarkPlugins: [["remark-gfm"]],
  },
});

const nextConfig: NextConfig = {
  output: "export",
  pageExtensions: ["ts", "tsx", "mdx"],
  transpilePackages: [
    "@propgate/dns",
    "@propgate/dns-fixtures",
    "@propgate/webhooks",
  ],
};

export default withMDX(nextConfig);
