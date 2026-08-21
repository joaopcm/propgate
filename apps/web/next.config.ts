import type { NextConfig } from "next";

// Side-effect import so a missing/invalid env var fails the build rather than
// the first request.
import "./src/env";

const nextConfig: NextConfig = {
  // A static export, deployed as assets on Cloudflare Workers, with a thin
  // Worker in `worker.ts` that only negotiates `Accept: text/markdown`. Pages
  // still prerender: there are no Next route handlers that run per request,
  // and the public checker is a client component that calls the API from the
  // browser. That keeps `@opennextjs/cloudflare` unnecessary — it exists for
  // apps that need a server at the edge, and this one still does not.
  //
  // The tripwire: `export` rules out ISR and request-time rendering. The day a
  // dashboard needs server-side auth, this becomes an OpenNext deployment, and
  // that should be a decision rather than a discovery. Markdown negotiation is
  // not that day — it is a header check in front of files that already exist.
  output: "export",
};

export default nextConfig;
