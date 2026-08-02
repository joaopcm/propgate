import type { NextConfig } from "next";

// Side-effect import so a missing/invalid env var fails the build rather than
// the first request.
import "./src/env";

const nextConfig: NextConfig = {
  // A static export, deployed as assets on Cloudflare Workers. Every page here
  // prerenders: there are no route handlers, no server actions, and the public
  // checker is a client component that calls the API from the browser. That
  // makes an adapter such as @opennextjs/cloudflare unnecessary — it exists for
  // apps that need a server at the edge, and this one does not.
  //
  // The tripwire: `export` rules out ISR and request-time rendering. The day a
  // dashboard needs server-side auth, this becomes an OpenNext deployment, and
  // that should be a decision rather than a discovery.
  output: "export",
};

export default nextConfig;
